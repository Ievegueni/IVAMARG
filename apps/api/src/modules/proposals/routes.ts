import { decisionSchema, listQuerySchema, PROPOSAL_STATUS, proposalCreateSchema, proposalVersionSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { proposalPdf } from './pdf';
import * as proposals from './service';

type Id = { Params: { id: string } };
const statusEnum = z.enum(Object.keys(PROPOSAL_STATUS) as [keyof typeof PROPOSAL_STATUS]);

export async function proposalRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('pipeline.view') };
  const edit = { preHandler: app.guard('pipeline.edit') };
  const approve = { preHandler: app.guard('pipeline.approve') };

  app.get('/', view, (req) =>
    proposals.listProposals(req.currentUser!, listQuerySchema.extend({ status: statusEnum.optional(), clientId: z.string().optional() }).parse(req.query)),
  );
  app.post('/', { preHandler: app.guard('pipeline.create') }, (req) => proposals.createProposal(ctxOf(req), req.currentUser!, proposalCreateSchema.parse(req.body)));
  app.get<Id>('/:id', view, (req) => proposals.getProposal(req.currentUser!, req.params.id));
  app.put<Id>('/:id/draft', edit, (req) =>
    proposals.updateDraft(ctxOf(req), req.currentUser!, req.params.id, proposalVersionSchema.extend({ title: z.string().trim().min(2).optional() }).parse(req.body)),
  );
  app.post<Id>('/:id/submit', edit, (req) => proposals.submitForApproval(ctxOf(req), req.currentUser!, req.params.id));
  app.post<Id>('/:id/approve', approve, (req) => proposals.decide(ctxOf(req), req.currentUser!, req.params.id, 'APPROVED', decisionSchema.parse(req.body ?? {}).comment));
  app.post<Id>('/:id/reject', approve, (req) => proposals.decide(ctxOf(req), req.currentUser!, req.params.id, 'REJECTED', decisionSchema.parse(req.body ?? {}).comment));
  app.post<Id>('/:id/send', edit, (req) => proposals.markSent(ctxOf(req), req.currentUser!, req.params.id));
  app.post<Id>('/:id/new-version', edit, (req) => proposals.newVersion(ctxOf(req), req.currentUser!, req.params.id));
  app.post<Id>('/:id/accept', edit, (req) => proposals.accept(ctxOf(req), req.currentUser!, req.params.id));
  app.post<Id>('/:id/decline', edit, (req) => proposals.decline(ctxOf(req), req.currentUser!, req.params.id, decisionSchema.parse(req.body ?? {}).comment));

  app.get<Id & { Querystring: { version?: string } }>('/:id/pdf', view, async (req, reply) => {
    const p = await proposals.getProposal(req.currentUser!, req.params.id);
    const version = Number(req.query.version) || p.currentVersion;
    const pdf = await proposalPdf(p, version);
    await audit(ctxOf(req), { entity: 'Proposal', entityId: p.id, action: 'pdf', after: { version } });
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="${p.number}-v${version}.pdf"`)
      .send(pdf);
  });
}
