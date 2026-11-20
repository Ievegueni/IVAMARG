import { opportunityMoveSchema, opportunitySchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import * as opps from './service';

type Id = { Params: { id: string } };

export async function opportunityRoutes(app: FastifyInstance) {
  const edit = { preHandler: app.guard('pipeline.edit') };

  app.get('/', { preHandler: app.guard('pipeline.view') }, (req) =>
    opps.listOpportunities(req.currentUser!, z.object({ businessLineId: z.string().optional(), clientId: z.string().optional(), ownerId: z.string().optional() }).parse(req.query)),
  );
  app.get<Id>('/:id', { preHandler: app.guard('pipeline.view') }, (req) => opps.getOpportunity(req.currentUser!, req.params.id));
  app.post('/', { preHandler: app.guard('pipeline.create') }, (req) => opps.createOpportunity(ctxOf(req), req.currentUser!, opportunitySchema.parse(req.body)));
  app.patch<Id>('/:id', edit, (req) => opps.updateOpportunity(ctxOf(req), req.currentUser!, req.params.id, opportunitySchema.partial().parse(req.body)));
  app.post<Id>('/:id/move', edit, (req) => {
    const b = opportunityMoveSchema.parse(req.body);
    return opps.moveOpportunity(ctxOf(req), req.currentUser!, req.params.id, b.stageId, b.lostReason);
  });
  app.delete<Id>('/:id', { preHandler: app.guard('pipeline.delete') }, async (req) => {
    const before = await opps.getOpportunity(req.currentUser!, req.params.id);
    await prisma.opportunity.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
    await audit(ctxOf(req), { entity: 'Opportunity', entityId: before.id, action: 'delete', before });
    return { ok: true };
  });
}
