import { listQuerySchema, operationSchema, phaseSchema, visitPlanSchema, visitUpdateSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { getClient } from '../clients/service';
import * as ops from './service';
import { planVisits, updateVisit } from './visits';

type Id = { Params: { id: string } };

export async function operationRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('operations.view') };
  const create = { preHandler: app.guard('operations.create') };
  const edit = { preHandler: app.guard('operations.edit') };

  // Obras (/projects) e furos (/boreholes): mesmas rotas.
  for (const [path, kind] of [['projects', 'Project'], ['boreholes', 'Borehole']] as const) {
    app.get(`/${path}`, view, (req) => ops.list(kind, listQuerySchema.extend({ status: z.string().optional(), clientId: z.string().optional() }).parse(req.query)));
    app.get<Id>(`/${path}/:id`, view, (req) => ops.get(kind, req.params.id));
    app.post(`/${path}`, create, async (req) => {
      const d = operationSchema.parse(req.body);
      await getClient(req.currentUser!, d.clientId);
      return ops.create(ctxOf(req), req.currentUser!, kind, d);
    });
    app.patch<Id>(`/${path}/:id`, edit, (req) => ops.update(ctxOf(req), kind, req.params.id, operationSchema.omit({ clientId: true }).partial().parse(req.body)));
    app.post<Id>(`/${path}/:id/phases`, edit, (req) => ops.savePhase(ctxOf(req), kind, req.params.id, null, phaseSchema.parse(req.body)));
    app.patch<{ Params: { id: string; phaseId: string } }>(`/${path}/:id/phases/:phaseId`, edit, (req) => ops.savePhase(ctxOf(req), kind, req.params.id, req.params.phaseId, phaseSchema.partial().parse(req.body)));
    app.post<Id>(`/${path}/:id/materials`, { preHandler: app.guard('stock.edit') }, (req) => {
      const b = z.object({ warehouseId: z.string(), lines: z.array(z.object({ itemId: z.string(), quantity: z.coerce.number().positive(), notes: z.string().optional().nullable() })).min(1) }).parse(req.body);
      return ops.issueMaterials(ctxOf(req), kind, req.params.id, b.warehouseId, b.lines);
    });
  }

  // ── Limpeza e jardinagem: visitas dos contratos recorrentes ──
  app.get('/visits', view, async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), contractId: z.string().optional() }).parse(req.query);
    return prisma.serviceVisit.findMany({
      where: { scheduledAt: { gte: q.from, lt: q.to }, ...(q.contractId && { contractId: q.contractId }) },
      include: { contract: { select: { id: true, number: true, title: true, client: { select: { id: true, name: true } } } } },
      orderBy: { scheduledAt: 'asc' },
    });
  });
  app.post<Id>('/contracts/:id/plan-visits', edit, (req) => planVisits(ctxOf(req), req.params.id, visitPlanSchema.parse(req.body)));
  app.patch<Id>('/visits/:id', edit, (req) => updateVisit(ctxOf(req), req.params.id, visitUpdateSchema.parse(req.body)));
  app.get('/cleaning-contracts', view, () =>
    prisma.contract.findMany({
      where: { deletedAt: null, status: 'ACTIVE', periodicity: { not: 'ONE_TIME' } },
      include: { client: { select: { id: true, name: true } }, _count: { select: { visits: true } } },
      orderBy: { number: 'asc' },
    }),
  );
}
