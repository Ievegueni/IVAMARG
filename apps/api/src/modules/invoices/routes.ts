import { invoiceRequestSchema, listQuerySchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { vendusPdf } from '../../integrations/vendus';
import { audit, ctxOf } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import * as invoices from './service';

type Id = { Params: { id: string } };

export async function invoiceRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.guard('finance.view') }, (req) =>
    invoices.listInvoices(req.currentUser!, listQuerySchema.extend({ clientId: z.string().optional(), orderId: z.string().optional(), status: z.string().optional() }).parse(req.query)),
  );
  app.post('/', { preHandler: app.guard('finance.create') }, (req) => {
    const b = invoiceRequestSchema.parse(req.body);
    return invoices.requestInvoice(ctxOf(req), req.currentUser!, b.source, b.sourceId, b.dueDate);
  });
  app.post<Id>('/:id/retry', { preHandler: app.guard('finance.create') }, (req) => invoices.retryInvoice(ctxOf(req), req.params.id));
  app.get<Id>('/:id/pdf', { preHandler: app.guard('finance.view') }, async (req, reply) => {
    const inv = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!inv) throw notFound('Factura');
    if (!inv.vendusDocumentId) throw new AppError(409, 'NOT_ISSUED', 'Factura ainda não emitida');
    const pdf = await vendusPdf(inv.vendusDocumentId);
    await audit(ctxOf(req), { entity: 'Invoice', entityId: inv.id, action: 'pdf' });
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${inv.number}.pdf"`).send(pdf);
  });
}
