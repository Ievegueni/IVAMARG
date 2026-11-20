import { clientSchema, contactSchema, interactionSchema, listQuerySchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { addTimeline } from '../../lib/timeline';
import * as clients from './service';

type Id = { Params: { id: string } };
const listQuery = listQuerySchema.extend({ ownerId: z.string().optional(), businessLineId: z.string().optional(), tag: z.string().optional() });

export async function clientRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('clients.view') };
  const create = { preHandler: app.guard('clients.create') };
  const edit = { preHandler: app.guard('clients.edit') };

  app.get('/', view, (req) => clients.listClients(req.currentUser!, listQuery.parse(req.query)));
  app.get('/check-duplicates', view, (req) => {
    const q = z.object({ nif: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), excludeId: z.string().optional() }).parse(req.query);
    return clients.findDuplicates({ nif: q.nif, email: q.email, phones: q.phone ? q.phone.split(',') : [] }, q.excludeId);
  });
  app.post('/', create, (req) => clients.createClient(ctxOf(req), req.currentUser!, clientSchema.parse(req.body)));
  app.post('/import', { ...create, bodyLimit: 10 * 1024 * 1024 }, (req) => {
    const b = z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(5000), dryRun: z.boolean() }).parse(req.body);
    return clients.importClients(ctxOf(req), req.currentUser!, b.rows, b.dryRun);
  });
  app.get<Id>('/:id', view, (req) => clients.getClient(req.currentUser!, req.params.id));
  app.patch<Id>('/:id', edit, (req) => clients.updateClient(ctxOf(req), req.currentUser!, req.params.id, clientSchema.partial().parse(req.body)));
  app.delete<Id>('/:id', { preHandler: app.guard('clients.delete') }, async (req) => {
    await clients.deleteClient(ctxOf(req), req.currentUser!, req.params.id);
    return { ok: true };
  });

  // ── Contactos ──
  app.post<Id>('/:id/contacts', edit, async (req) => {
    await clients.getClient(req.currentUser!, req.params.id);
    const contact = await prisma.clientContact.create({ data: { ...contactSchema.parse(req.body), clientId: req.params.id } });
    await audit(ctxOf(req), { entity: 'ClientContact', entityId: contact.id, action: 'create', after: contact });
    return contact;
  });
  app.patch<{ Params: { id: string; contactId: string } }>('/:id/contacts/:contactId', edit, async (req) => {
    await clients.getClient(req.currentUser!, req.params.id);
    const before = await prisma.clientContact.findFirst({ where: { id: req.params.contactId, clientId: req.params.id, deletedAt: null } });
    if (!before) throw notFound('Contacto');
    const after = await prisma.clientContact.update({ where: { id: before.id }, data: contactSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'ClientContact', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.delete<{ Params: { id: string; contactId: string } }>('/:id/contacts/:contactId', edit, async (req) => {
    await clients.getClient(req.currentUser!, req.params.id);
    const before = await prisma.clientContact.findFirst({ where: { id: req.params.contactId, clientId: req.params.id, deletedAt: null } });
    if (!before) throw notFound('Contacto');
    await prisma.clientContact.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
    await audit(ctxOf(req), { entity: 'ClientContact', entityId: before.id, action: 'delete', before });
    return { ok: true };
  });

  // ── Timeline ──
  app.get<Id>('/:id/timeline', view, async (req) => {
    await clients.getClient(req.currentUser!, req.params.id);
    const q = listQuerySchema.parse(req.query);
    const where = { clientId: req.params.id };
    const [items, total] = await Promise.all([
      prisma.timelineEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.timelineEvent.count({ where }),
    ]);
    const users = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.userId!).filter(Boolean) } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return pageResult(items.map((i) => ({ ...i, userName: i.userId ? names.get(i.userId) : null })), total, q);
  });
  app.post<Id>('/:id/interactions', edit, async (req) => {
    await clients.getClient(req.currentUser!, req.params.id);
    const d = interactionSchema.parse(req.body);
    return prisma.$transaction(async (tx) => {
      const ev = await addTimeline(tx, { ...d, clientId: req.params.id, userId: req.currentUser!.id });
      await audit(ctxOf(req), { entity: 'TimelineEvent', entityId: ev.id, action: 'create', after: ev }, tx);
      return ev;
    });
  });
}
