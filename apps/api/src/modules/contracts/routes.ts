import { contractSchema, listQuerySchema } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { seesAll } from '../../lib/scope';
import { nextNumber } from '../../lib/sequence';
import { addTimeline } from '../../lib/timeline';
import { getClient } from '../clients/service';
import type { PublicUser } from '../users/service';

type Id = { Params: { id: string } };
const include = { client: { select: { id: true, name: true } }, proposal: { select: { id: true, number: true } } };
// Contratos seguem a carteira do cliente.
const scope = (u: PublicUser): Prisma.ContractWhereInput => (seesAll(u, 'pipeline') ? {} : { client: { ownerId: u.id } });

// CRUD simples; o documento anexo entra com a gestão documental (S3).
export async function contractRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('pipeline.view') };

  app.get('/', view, async (req) => {
    const q = listQuerySchema.extend({ clientId: z.string().optional(), status: z.string().optional() }).parse(req.query);
    const where: Prisma.ContractWhereInput = {
      deletedAt: null,
      ...scope(req.currentUser!),
      ...(q.clientId && { clientId: q.clientId }),
      ...(q.status && { status: q.status as never }),
      ...(q.search && { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }, { client: { name: { contains: q.search, mode: 'insensitive' } } }] }),
    };
    const [items, total] = await Promise.all([
      prisma.contract.findMany({ where, include, ...pageArgs(q, ['number', 'startDate', 'endDate', 'value'], { startDate: 'desc' }) }),
      prisma.contract.count({ where }),
    ]);
    return pageResult(items, total, q);
  });

  app.get<Id>('/:id', view, async (req) => {
    const c = await prisma.contract.findFirst({ where: { id: req.params.id, deletedAt: null, ...scope(req.currentUser!) }, include });
    if (!c) throw notFound('Contrato');
    return c;
  });

  app.post('/', { preHandler: app.guard('pipeline.create') }, async (req) => {
    const d = contractSchema.parse(req.body);
    await getClient(req.currentUser!, d.clientId);
    return prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({ data: { ...d, number: await nextNumber(tx, 'CTR'), createdById: req.currentUser!.id }, include });
      await addTimeline(tx, { clientId: c.clientId, title: `Contrato ${c.number} criado`, userId: req.currentUser!.id, entity: 'Contract', entityId: c.id });
      await audit(ctxOf(req), { entity: 'Contract', entityId: c.id, action: 'create', after: c }, tx);
      return c;
    });
  });

  app.patch<Id>('/:id', { preHandler: app.guard('pipeline.edit') }, async (req) => {
    const before = await prisma.contract.findFirst({ where: { id: req.params.id, deletedAt: null, ...scope(req.currentUser!) } });
    if (!before) throw notFound('Contrato');
    const after = await prisma.contract.update({ where: { id: before.id }, data: contractSchema.omit({ clientId: true }).partial().parse(req.body), include });
    await audit(ctxOf(req), { entity: 'Contract', entityId: before.id, action: 'update', before, after });
    return after;
  });
}
