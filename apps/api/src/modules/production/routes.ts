import { hasPermission, issueSchema, listQuerySchema, releaseSchema, stageFinishSchema, stageStartSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { forbidden } from '../../lib/errors';
import { labelsPdf } from './labels';
import { productionOrderPdf } from './pdf';
import * as po from './service';

type Id = { Params: { id: string } };

export async function productionRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('production.view') };
  const edit = { preHandler: app.guard('production.edit') };

  app.get('/orders', view, (req) => po.listPOs(req.currentUser!, listQuerySchema.extend({ status: z.string().optional(), orderId: z.string().optional() }).parse(req.query)));
  app.post('/orders', { preHandler: app.guard('production.create') }, (req) => {
    const b = z.object({ orderId: z.string(), warehouseId: z.string().optional() }).parse(req.body);
    return po.createFromOrder(ctxOf(req), b.orderId, b.warehouseId);
  });
  app.get<Id>('/orders/:id', view, (req) => po.getPO(req.params.id));
  app.post<Id>('/orders/:id/release', edit, (req) => po.releasePO(ctxOf(req), req.params.id, releaseSchema.parse(req.body ?? {}).force));
  app.post<Id>('/orders/:id/issue', { preHandler: app.guard('stock.edit') }, (req) => po.issueMaterials(ctxOf(req), req.params.id, issueSchema.parse(req.body).lines));
  app.post<Id>('/orders/:id/complete', edit, (req) => po.completePO(ctxOf(req), req.params.id));
  app.post<Id>('/orders/:id/cancel', { preHandler: app.guard('production.delete') }, (req) => po.cancelPO(ctxOf(req), req.params.id));
  app.get<Id & { Querystring: { lots?: string } }>('/orders/:id/labels', view, async (req, reply) => {
    const p = await po.getPO(req.params.id);
    const only = req.query.lots?.split(',');
    const pdf = await labelsPdf(p, p.lots.filter((l) => !only || only.includes(l.id)));
    await audit(ctxOf(req), { entity: 'ProductionOrder', entityId: p.id, action: 'labels' });
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="etiquetas-${p.number}.pdf"`).send(pdf);
  });

  app.get<Id>('/orders/:id/pdf', view, async (req, reply) => {
    const p = await po.getPO(req.params.id);
    await audit(ctxOf(req), { entity: 'ProductionOrder', entityId: p.id, action: 'pdf' });
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${p.number}.pdf"`).send(await productionOrderPdf(p));
  });

  // Registo de etapas pelo escritório (escolhe operador / fornecedor).
  app.post('/logs', edit, (req) => po.startStage(ctxOf(req), stageStartSchema.parse(req.body)));
  app.post<Id>('/logs/:id/finish', edit, (req) => po.finishStage(ctxOf(req), req.params.id, stageFinishSchema.parse(req.body)));

  app.get<Id>('/order-margin/:id', { preHandler: app.guard('production.view') }, (req) => po.orderMargin(req.params.id));
  // Remuneração: quem aprova produção ou o financeiro (não basta ver encomendas).
  app.get('/piece-pay', { preHandler: app.guard() }, (req) => {
    if (!hasPermission(req.currentUser!, 'production.approve') && !hasPermission(req.currentUser!, 'finance.viewAll')) throw forbidden();
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    return po.piecePay(q.from, q.to);
  });
}
