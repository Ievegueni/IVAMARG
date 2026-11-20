import { stageFinishSchema, stageStartSchema } from '@ivamarg/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { AppError, notFound, unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { lotFlow } from '../production/calc';
import { pinLookup } from '../production/config.routes';
import { finishStage, startStage, type Actor } from '../production/service';

// Chão de fábrica: o operador entra só com o PIN num dispositivo partilhado.
// Token próprio (kind: 'op'), curto, que não dá acesso ao resto da API.
const OP_TTL = '12h';

async function operatorOf(app: FastifyInstance, req: FastifyRequest): Promise<Actor> {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) throw unauthorized();
  let p: { sub: string; kind?: string };
  try {
    p = app.jwt.verify(token);
  } catch {
    throw unauthorized();
  }
  if (p.kind !== 'op') throw unauthorized();
  const op = await prisma.operator.findUnique({ where: { id: p.sub } });
  if (!op?.active) throw unauthorized('Operador inactivo');
  return { operatorId: op.id, ip: req.ip };
}

export async function floorRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { pin } = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN inválido') }).parse(req.body);
    const op = await prisma.operator.findUnique({ where: { pinLookup: pinLookup(pin) }, include: { section: { select: { name: true } } } });
    if (!op?.active) throw new AppError(401, 'INVALID_PIN', 'PIN incorrecto');
    await audit({ ip: req.ip }, { entity: 'Operator', entityId: op.id, action: 'floor_login' });
    return { token: app.jwt.sign({ sub: op.id, kind: 'op' }, { expiresIn: OP_TTL }), operator: { id: op.id, name: op.name, code: op.code, section: op.section?.name ?? null } };
  });

  /** Lote pelo token do QR (ou nº do lote escrito à mão). */
  app.get<{ Params: { code: string } }>('/lots/:code', async (req) => {
    await operatorOf(app, req);
    const code = decodeURIComponent(req.params.code).trim();
    const token = code.match(/lote=([\w-]+)/)?.[1] ?? code;
    const lot = await prisma.lot.findFirst({
      where: { OR: [{ qrToken: token }, { number: { equals: token, mode: 'insensitive' } }] },
      include: {
        productModel: { select: { reference: true, name: true } },
        productionOrder: { select: { number: true, status: true, order: { select: { number: true, deadline: true, personalizationName: true, personalizationNotes: true, client: { select: { name: true } } } } } },
        logs: { include: { operator: { select: { name: true } } }, orderBy: { startedAt: 'asc' } },
      },
    });
    if (!lot) throw notFound('Lote');
    const stages = await prisma.productionStage.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
    const f = lotFlow(lot.quantity, stages, lot.logs);
    return {
      ...lot,
      finished: f.finished,
      scrapped: f.scrapped,
      complete: f.complete,
      stages: stages.map((s) => ({ id: s.id, name: s.name, type: s.type, order: s.order, ...f.flow.get(s.id)! })),
      openLogs: lot.logs.filter((l) => !l.finishedAt).map((l) => ({ ...l, stageName: stages.find((s) => s.id === l.stageId)?.name })),
    };
  });

  app.post('/start', async (req) => {
    const actor = await operatorOf(app, req);
    const d = stageStartSchema.parse(req.body);
    return startStage(actor, { ...d, operatorId: actor.operatorId, supplierId: null });
  });
  app.post<{ Params: { id: string } }>('/logs/:id/finish', async (req) => finishStage(await operatorOf(app, req), req.params.id, stageFinishSchema.parse(req.body)));

  app.get('/my-open', async (req) => {
    const { operatorId } = await operatorOf(app, req);
    return prisma.stageLog.findMany({
      where: { operatorId, finishedAt: null },
      include: { stage: { select: { name: true } }, lot: { select: { number: true, qrToken: true, size: true, productModel: { select: { reference: true } } } } },
      orderBy: { startedAt: 'asc' },
    });
  });
  app.get('/defect-types', async (req) => {
    await operatorOf(app, req);
    return prisma.defectType.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  });
}
