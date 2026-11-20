import { eventBaseSchema, eventSchema, listQuerySchema, taskSchema } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { clientIdOf } from '../../lib/clientOf';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { seesAll } from '../../lib/scope';
import { addTimeline } from '../../lib/timeline';
import type { PublicUser } from '../users/service';

type Id = { Params: { id: string } };
// Sem tasks.viewAll: só as tarefas atribuídas a mim ou criadas por mim.
const taskScope = (u: PublicUser): Prisma.TaskWhereInput => (seesAll(u, 'tasks') ? {} : { OR: [{ assigneeId: u.id }, { createdById: u.id }] });
const eventScope = (u: PublicUser): Prisma.CalendarEventWhereInput => (seesAll(u, 'tasks') ? {} : { OR: [{ attendeeIds: { has: u.id } }, { createdById: u.id }] });
const include = { assignee: { select: { id: true, name: true } } };

async function getTask(u: PublicUser, id: string) {
  const t = await prisma.task.findFirst({ where: { id, deletedAt: null, ...taskScope(u) }, include });
  if (!t) throw notFound('Tarefa');
  return t;
}

export async function taskRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('tasks.view') };
  const edit = { preHandler: app.guard('tasks.edit') };

  app.get('/', view, async (req) => {
    const u = req.currentUser!;
    const q = listQuerySchema
      .extend({ status: z.string().optional(), assigneeId: z.string().optional(), mine: z.coerce.boolean().optional(), overdue: z.coerce.boolean().optional(), entity: z.string().optional(), entityId: z.string().optional() })
      .parse(req.query);
    const open = { status: { in: ['TODO', 'IN_PROGRESS'] as ('TODO' | 'IN_PROGRESS')[] } };
    const where: Prisma.TaskWhereInput = {
      deletedAt: null,
      ...taskScope(u),
      ...(q.mine && { assigneeId: u.id }),
      ...(q.assigneeId && { assigneeId: q.assigneeId }),
      ...(q.status === 'OPEN' ? open : q.status && { status: q.status as never }),
      ...(q.overdue && { ...open, dueAt: { lt: new Date() } }),
      ...(q.entity && q.entityId && { entity: q.entity, entityId: q.entityId }),
      ...(q.search && { title: { contains: q.search, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      prisma.task.findMany({ where, include, ...pageArgs(q, ['dueAt', 'createdAt', 'priority'], { dueAt: 'asc' }) }),
      prisma.task.count({ where }),
    ]);
    return pageResult(items, total, q);
  });

  app.post('/', { preHandler: app.guard('tasks.create') }, async (req) => {
    const u = req.currentUser!;
    const d = taskSchema.parse(req.body);
    const clientId = d.entity && d.entityId ? await clientIdOf(d.entity, d.entityId) : null;
    const t = await prisma.$transaction(async (tx) => {
      const t = await tx.task.create({ data: { ...d, clientId, createdById: u.id, completedAt: d.status === 'DONE' ? new Date() : null }, include });
      if (clientId) await addTimeline(tx, { clientId, title: `Tarefa: ${t.title} (${t.assignee.name})`, userId: u.id, entity: 'Task', entityId: t.id });
      await audit(ctxOf(req), { entity: 'Task', entityId: t.id, action: 'create', after: t }, tx);
      return t;
    });
    if (t.assigneeId !== u.id) await notify([t.assigneeId], { title: `Nova tarefa: ${t.title}`, body: `Atribuída por ${u.name}`, link: '/tarefas' });
    return t;
  });

  app.patch<Id>('/:id', edit, async (req) => {
    const u = req.currentUser!;
    const before = await getTask(u, req.params.id);
    const d = taskSchema.partial().parse(req.body);
    const after = await prisma.task.update({
      where: { id: before.id },
      data: {
        ...d,
        ...(d.status && d.status !== before.status && { completedAt: d.status === 'DONE' ? new Date() : null }),
        ...(d.dueAt !== undefined && { remindedAt: null }),
      },
      include,
    });
    await audit(ctxOf(req), { entity: 'Task', entityId: before.id, action: d.status === 'DONE' && before.status !== 'DONE' ? 'complete' : 'update', before, after });
    if (d.assigneeId && d.assigneeId !== before.assigneeId && d.assigneeId !== u.id) {
      await notify([d.assigneeId], { title: `Tarefa atribuída: ${after.title}`, body: `Por ${u.name}`, link: '/tarefas' });
    }
    return after;
  });

  app.delete<Id>('/:id', { preHandler: app.guard('tasks.delete') }, async (req) => {
    const t = await getTask(req.currentUser!, req.params.id);
    if (!seesAll(req.currentUser!, 'tasks') && t.createdById !== req.currentUser!.id) throw forbidden();
    await prisma.task.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
    await audit(ctxOf(req), { entity: 'Task', entityId: t.id, action: 'delete', before: t });
    return { ok: true };
  });

  // ── Agenda ──
  app.get('/events', view, async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), userId: z.string().optional() }).parse(req.query);
    const u = req.currentUser!;
    return prisma.calendarEvent.findMany({
      where: {
        deletedAt: null,
        ...eventScope(u),
        ...(q.userId && seesAll(u, 'tasks') && { OR: [{ attendeeIds: { has: q.userId } }, { createdById: q.userId }] }),
        startAt: { lt: q.to },
        endAt: { gte: q.from },
      },
      orderBy: { startAt: 'asc' },
    });
  });
  app.post('/events', { preHandler: app.guard('tasks.create') }, async (req) => {
    const u = req.currentUser!;
    const d = eventSchema.parse(req.body);
    const clientId = d.entity && d.entityId ? await clientIdOf(d.entity, d.entityId) : null;
    const attendeeIds = [...new Set([u.id, ...d.attendeeIds])];
    const ev = await prisma.$transaction(async (tx) => {
      const ev = await tx.calendarEvent.create({ data: { ...d, attendeeIds, clientId, createdById: u.id } });
      if (clientId) await addTimeline(tx, { clientId, type: d.type === 'VISIT' ? 'VISIT' : 'MEETING', title: `Agendado: ${ev.title}`, userId: u.id, entity: 'CalendarEvent', entityId: ev.id, occurredAt: ev.startAt });
      await audit(ctxOf(req), { entity: 'CalendarEvent', entityId: ev.id, action: 'create', after: ev }, tx);
      return ev;
    });
    await notify(attendeeIds.filter((a) => a !== u.id), { title: `Convite: ${ev.title}`, body: `${u.name} adicionou-o a um evento na agenda.`, link: '/agenda' });
    return ev;
  });
  app.patch<Id>('/events/:id', edit, async (req) => {
    const before = await prisma.calendarEvent.findFirst({ where: { id: req.params.id, deletedAt: null, ...eventScope(req.currentUser!) } });
    if (!before) throw notFound('Evento');
    const d = eventBaseSchema.partial().parse(req.body);
    if ((d.startAt ?? before.startAt) > (d.endAt ?? before.endAt)) throw new AppError(400, 'VALIDATION_ERROR', 'O fim tem de ser depois do início');
    const after = await prisma.calendarEvent.update({ where: { id: before.id }, data: d });
    await audit(ctxOf(req), { entity: 'CalendarEvent', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.delete<Id>('/events/:id', edit, async (req) => {
    const before = await prisma.calendarEvent.findFirst({ where: { id: req.params.id, deletedAt: null, ...eventScope(req.currentUser!) } });
    if (!before) throw notFound('Evento');
    await prisma.calendarEvent.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
    await audit(ctxOf(req), { entity: 'CalendarEvent', entityId: before.id, action: 'delete', before });
    return { ok: true };
  });
}
