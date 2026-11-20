import { defectTypeSchema, operatorSchema, productionStageSchema, sectionSchema, stageRateSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { audit, ctxOf } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { env } from '../../lib/env';
import { prisma } from '../../lib/prisma';

type Id = { Params: { id: string } };
export const pinLookup = (pin: string) => createHmac('sha256', env.JWT_SECRET).update(`pin:${pin}`).digest('hex');

/** Backoffice de produção: secções, etapas, operadores, valores por peça, defeitos. */
export async function productionConfigRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('production.view') };
  const edit = { preHandler: app.guard('backoffice.edit') };

  // Pequenos CRUD genéricos com auditoria.
  const crud = <T extends { parse: (b: unknown) => object; partial: () => { parse: (b: unknown) => object } }>(
    path: string,
    entity: string,
    model: { findMany: (a: object) => Promise<unknown>; create: (a: { data: object }) => Promise<{ id: string }>; findUnique: (a: { where: { id: string } }) => Promise<unknown>; update: (a: { where: { id: string }; data: object }) => Promise<unknown> },
    schema: T,
    orderBy: object,
  ) => {
    app.get(path, view, () => model.findMany({ orderBy }));
    app.post(path, edit, async (req) => {
      const row = await model.create({ data: schema.parse(req.body) });
      await audit(ctxOf(req), { entity, entityId: row.id, action: 'create', after: row });
      return row;
    });
    app.patch<Id>(`${path}/:id`, edit, async (req) => {
      const before = await model.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound();
      const after = await model.update({ where: { id: req.params.id }, data: schema.partial().parse(req.body) });
      await audit(ctxOf(req), { entity, entityId: req.params.id, action: 'update', before, after });
      return after;
    });
  };

  crud('/sections', 'ProductionSection', prisma.productionSection as never, sectionSchema, { name: 'asc' });
  crud('/stages', 'ProductionStage', prisma.productionStage as never, productionStageSchema, { order: 'asc' });
  crud('/defect-types', 'DefectType', prisma.defectType as never, defectTypeSchema, { name: 'asc' });

  // ── Operadores (PIN guardado só como HMAC; único para entrar só com o PIN) ──
  const opSelect = { id: true, name: true, code: true, sectionId: true, payModel: true, fixedSalary: true, active: true, pinLookup: true, section: { select: { name: true } } };
  const publicOp = <T extends { pinLookup: string | null }>({ pinLookup: p, ...o }: T) => ({ ...o, hasPin: !!p });

  app.get('/operators', view, async () => (await prisma.operator.findMany({ select: opSelect, orderBy: { name: 'asc' } })).map(publicOp));
  app.post('/operators', edit, async (req) => {
    const { pin, ...d } = operatorSchema.parse(req.body);
    const op = await prisma.operator.create({ data: { ...d, pinLookup: pin ? pinLookup(pin) : null }, select: opSelect }).catch(pinConflict);
    await audit(ctxOf(req), { entity: 'Operator', entityId: op.id, action: 'create', after: publicOp(op) });
    return publicOp(op);
  });
  app.patch<Id>('/operators/:id', edit, async (req) => {
    const before = await prisma.operator.findUnique({ where: { id: req.params.id }, select: opSelect });
    if (!before) throw notFound('Operador');
    const { pin, ...d } = operatorSchema.partial().parse(req.body);
    const after = await prisma.operator.update({ where: { id: before.id }, data: { ...d, ...(pin && { pinLookup: pinLookup(pin) }) }, select: opSelect }).catch(pinConflict);
    await audit(ctxOf(req), { entity: 'Operator', entityId: before.id, action: pin ? 'update+pin' : 'update', before: publicOp(before), after: publicOp(after) });
    return publicOp(after);
  });

  // ── Valores por peça ──
  app.get('/rates', view, () => prisma.stageRate.findMany({ include: { stage: { select: { name: true } }, productModel: { select: { reference: true, name: true } } } }));
  app.put('/rates', edit, async (req) => {
    const d = stageRateSchema.parse(req.body);
    const existing = await prisma.stageRate.findFirst({ where: { stageId: d.stageId, productModelId: d.productModelId ?? null } });
    const row = existing
      ? await prisma.stageRate.update({ where: { id: existing.id }, data: { rate: d.rate } })
      : await prisma.stageRate.create({ data: { stageId: d.stageId, productModelId: d.productModelId ?? null, rate: d.rate } });
    await audit(ctxOf(req), { entity: 'StageRate', entityId: row.id, action: 'upsert', before: existing, after: row });
    return row;
  });
  app.delete<Id>('/rates/:id', edit, async (req) => {
    const before = await prisma.stageRate.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound();
    await prisma.stageRate.delete({ where: { id: before.id } });
    await audit(ctxOf(req), { entity: 'StageRate', entityId: before.id, action: 'delete', before });
    return { ok: true };
  });
}

function pinConflict(e: unknown): never {
  if ((e as { code?: string }).code === 'P2002' && String((e as { meta?: { target?: unknown } }).meta?.target).includes('pinLookup')) {
    throw new AppError(409, 'PIN_IN_USE', 'Este PIN já está atribuído a outro operador');
  }
  throw e;
}
