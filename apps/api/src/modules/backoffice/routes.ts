import { businessLineCreateSchema, businessLineSchema, featureFlagUpdateSchema, pipelineStageSchema, payrollRulesSchema, settingUpdateSchema } from '@ivamarg/shared';
import { AppError } from '../../lib/errors';
import type { FastifyInstance } from 'fastify';
import { audit, ctxOf } from '../../lib/audit';
import { DEFAULT_PIPELINE_STAGES } from '../../lib/defaults';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { getSetting } from '../../lib/settings';

export async function backofficeRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('backoffice.view') };
  const edit = { preHandler: app.guard('backoffice.edit') };

  // ── Settings ──
  app.get('/settings', view, () => prisma.setting.findMany({ orderBy: { key: 'asc' } }));
  app.patch<{ Params: { key: string } }>('/settings/:key', edit, async (req) => {
    const { value } = settingUpdateSchema.parse(req.body);
    if (req.params.key === 'hr.payroll') payrollRulesSchema.parse(value);
    const before = await prisma.setting.findUnique({ where: { key: req.params.key } });
    if (!before) throw notFound('Configuração');
    const after = await prisma.setting.update({ where: { key: before.key }, data: { value: value as object } });
    await audit(ctxOf(req), { entity: 'Setting', entityId: before.key, action: 'update', before, after });
    return after;
  });

  // Valores de configuração que os ecrãs precisam (sem exigir acesso ao backoffice).
  app.get('/app-settings', { preHandler: app.guard() }, async () => ({
    proposalValidityDays: await getSetting('proposals.validityDays', 30),
    approvalThreshold: await getSetting('proposals.approvalThreshold', 0),
    orderSizes: await getSetting<string[]>('orders.sizes', []),
  }));

  // ── Feature flags ──
  app.get('/feature-flags', view, () => prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }));
  app.patch<{ Params: { key: string } }>('/feature-flags/:key', edit, async (req) => {
    const { enabled } = featureFlagUpdateSchema.parse(req.body);
    const before = await prisma.featureFlag.findUnique({ where: { key: req.params.key } });
    if (!before) throw notFound('Funcionalidade');
    const after = await prisma.featureFlag.update({ where: { key: before.key }, data: { enabled } });
    await audit(ctxOf(req), { entity: 'FeatureFlag', entityId: before.key, action: 'update', before, after });
    return after;
  });

  // ── Linhas de negócio ──
  app.get('/business-lines', { preHandler: app.guard() }, () =>
    prisma.businessLine.findMany({ orderBy: { order: 'asc' }, include: { pipelineStages: { orderBy: { order: 'asc' } } } }),
  );
  app.post('/business-lines', edit, async (req) => {
    const data = businessLineCreateSchema.parse(req.body);
    const line = await prisma.businessLine.create({
      data: { ...data, pipelineStages: { create: DEFAULT_PIPELINE_STAGES.map((s, i) => ({ ...s, order: i + 1 })) } },
    });
    await audit(ctxOf(req), { entity: 'BusinessLine', entityId: line.id, action: 'create', after: line });
    return line;
  });
  app.patch<{ Params: { id: string } }>('/business-lines/:id', edit, async (req) => {
    const data = businessLineSchema.partial().parse(req.body);
    const before = await prisma.businessLine.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Linha de negócio');
    const after = await prisma.businessLine.update({ where: { id: before.id }, data });
    await audit(ctxOf(req), { entity: 'BusinessLine', entityId: before.id, action: 'update', before, after });
    return after;
  });

  // ── Estados do funil ──
  app.post('/pipeline-stages', edit, async (req) => {
    const stage = await prisma.pipelineStage.create({ data: pipelineStageSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'PipelineStage', entityId: stage.id, action: 'create', after: stage });
    return stage;
  });
  app.patch<{ Params: { id: string } }>('/pipeline-stages/:id', edit, async (req) => {
    const data = pipelineStageSchema.omit({ businessLineId: true }).partial().parse(req.body);
    const before = await prisma.pipelineStage.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Estado do funil');
    if (data.active === false) {
      const inUse = await prisma.opportunity.count({ where: { stageId: before.id, deletedAt: null, closedAt: null } });
      if (inUse) throw new AppError(409, 'IN_USE', `Há ${inUse} oportunidade(s) abertas neste estado. Mova-as primeiro.`);
    }
    const after = await prisma.pipelineStage.update({ where: { id: before.id }, data });
    await audit(ctxOf(req), { entity: 'PipelineStage', entityId: before.id, action: 'update', before, after });
    return after;
  });
}
