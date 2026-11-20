import { listQuerySchema, ORDER_STATUS, orderSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf } from '../../lib/audit';
import * as orders from './service';

type Id = { Params: { id: string } };

export async function orderRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('production.view') };
  app.get('/', view, (req) =>
    orders.listOrders(
      req.currentUser!,
      listQuerySchema.extend({ status: z.enum(Object.keys(ORDER_STATUS) as [keyof typeof ORDER_STATUS]).optional(), clientId: z.string().optional() }).parse(req.query),
    ),
  );
  app.get<Id>('/:id', view, (req) => orders.getOrder(req.currentUser!, req.params.id));
  app.post('/', { preHandler: app.guard('production.create') }, (req) => orders.createOrder(ctxOf(req), req.currentUser!, orderSchema.parse(req.body)));
  app.patch<Id>('/:id', { preHandler: app.guard('production.edit') }, (req) =>
    orders.updateOrder(ctxOf(req), req.currentUser!, req.params.id, orderSchema.partial().parse(req.body)),
  );
}
