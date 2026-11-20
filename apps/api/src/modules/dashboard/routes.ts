import type { FastifyInstance } from 'fastify';
import { todayLuanda } from '../../jobs/alerts';
import { prisma } from '../../lib/prisma';
import { D } from '../stock/core';
import { lotFlow } from '../production/calc';
import { orderMargin } from '../production/service';

const DAY = 86400000;

/** Lotes em aberto: peças em curso + à espera em cada etapa (para kanban e gargalos). */
async function lotsByStage() {
  const stages = await prisma.productionStage.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
  const lots = await prisma.lot.findMany({ where: { status: 'OPEN', productionOrder: { status: 'RELEASED' } }, include: { logs: true } });
  const acc = new Map(stages.map((s) => [s.id, { stageId: s.id, name: s.name, waiting: 0, inProgress: 0, lots: 0 }]));
  for (const l of lots) {
    const f = lotFlow(l.quantity, stages, l.logs);
    for (const s of stages) {
      const x = f.flow.get(s.id)!;
      const a = acc.get(s.id)!;
      a.waiting += x.available;
      a.inProgress += x.inProgress;
      if (x.available || x.inProgress) a.lots++;
    }
  }
  const rows = [...acc.values()];
  const bottleneck = rows.reduce((m, r) => (r.waiting + r.inProgress > (m?.waiting ?? 0) + (m?.inProgress ?? 0) ? r : m), null as (typeof rows)[number] | null);
  return { rows, bottleneck: bottleneck && bottleneck.waiting + bottleneck.inProgress > 0 ? bottleneck.name : null, openLots: lots.length, lastStageId: stages.at(-1)?.id };
}

async function production(now: Date) {
  const today = todayLuanda(now);
  const startOfDay = new Date(today.getTime() - 3600_000); // 00:00 Luanda = 23:00 UTC do dia anterior
  const stages = await lotsByStage();
  const [released, finishedToday, late] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { status: 'RELEASED' },
      include: { order: { select: { number: true, deadline: true, client: { select: { name: true } } } }, items: { select: { quantity: true } }, lots: { include: { logs: { where: { stageId: stages.lastStageId } } } } },
      orderBy: { order: { deadline: 'asc' } },
    }),
    stages.lastStageId ? prisma.stageLog.aggregate({ where: { stageId: stages.lastStageId, finishedAt: { gte: startOfDay } }, _sum: { qtyDone: true } }) : null,
    prisma.order.findMany({
      where: { deletedAt: null, deadline: { lt: today }, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      select: { id: true, number: true, deadline: true, status: true, client: { select: { name: true } } },
      orderBy: { deadline: 'asc' },
      take: 10,
    }),
  ]);
  const ops = released.map((p) => {
    const qty = p.items.reduce((s, i) => s + i.quantity, 0);
    const done = p.lots.flatMap((l) => l.logs).reduce((s, l) => s + l.qtyDone, 0);
    return { id: p.id, number: p.number, client: p.order.client.name, orderNumber: p.order.number, deadline: p.order.deadline, quantity: qty, done, progress: qty ? Math.round((done / qty) * 100) : 0 };
  });
  return { stages: stages.rows, bottleneck: stages.bottleneck, openLots: stages.openLots, ops, piecesToday: finishedToday?._sum.qtyDone ?? 0, lateOrders: late };
}

async function quality(now: Date) {
  const since = new Date(now.getTime() - 30 * DAY);
  const logs = await prisma.stageLog.findMany({ where: { finishedAt: { gte: since }, stage: { type: 'QUALITY' } }, include: { defects: { include: { defectType: true } } } });
  const inspected = logs.reduce((s, l) => s + l.qtyIn, 0);
  const rejected = logs.reduce((s, l) => s + l.qtyRejected, 0);
  const rework = logs.reduce((s, l) => s + l.qtyRework, 0);
  const byType = new Map<string, number>();
  for (const d of logs.flatMap((l) => l.defects)) byType.set(d.defectType.name, (byType.get(d.defectType.name) ?? 0) + d.quantity);
  return {
    inspected,
    scrap: rejected,
    rework,
    defectRate: inspected ? Math.round(((rejected + rework) / inspected) * 1000) / 10 : 0,
    topDefects: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, quantity]) => ({ name, quantity })),
  };
}

async function stock() {
  const items = await prisma.stockItem.findMany({ where: { active: true, deletedAt: null, minStock: { gt: 0 } }, include: { levels: true } });
  const low = items
    .map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit, minStock: Number(i.minStock), available: i.levels.reduce((s, l) => s.plus(l.onHand).minus(l.reserved), D(0)).toNumber() }))
    .filter((i) => i.available < i.minStock)
    .sort((a, b) => a.available / a.minStock - b.available / b.minStock);
  const over = await prisma.materialRequirement.findMany({
    where: { productionOrder: { status: { in: ['RELEASED', 'COMPLETED'] }, releasedAt: { gte: new Date(Date.now() - 60 * DAY) } }, required: { gt: 0 } },
    include: { item: { select: { code: true, name: true } }, productionOrder: { select: { id: true, number: true } } },
  });
  const overConsumption = over
    .map((r) => ({ po: r.productionOrder, item: r.item, pct: Math.round(((Number(r.issued) - Number(r.required)) / Number(r.required)) * 1000) / 10 }))
    .filter((r) => r.pct > 5)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);
  return { belowMin: low.length, low: low.slice(0, 8), overConsumption };
}

async function commercial(now: Date, ownerId?: string) {
  const own = ownerId ? { ownerId } : {};
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since90 = new Date(now.getTime() - 90 * DAY);
  const [open, wonMonth, closed90, pendingApproval, proposalsOpen] = await Promise.all([
    prisma.opportunity.findMany({ where: { deletedAt: null, closedAt: null, ...own }, select: { value: true, stage: { select: { name: true } } } }),
    prisma.opportunity.aggregate({ where: { deletedAt: null, closedAt: { gte: monthStart }, stage: { isWon: true }, ...own }, _sum: { value: true }, _count: true }),
    prisma.opportunity.findMany({ where: { deletedAt: null, closedAt: { gte: since90 }, ...own }, select: { stage: { select: { isWon: true } } } }),
    prisma.proposal.count({ where: { deletedAt: null, status: 'PENDING_APPROVAL', ...own } }),
    prisma.proposal.findMany({
      where: { deletedAt: null, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'] }, ...own },
      select: { id: true, number: true, title: true, status: true, total: true, client: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
  ]);
  const byStage = new Map<string, { stage: string; count: number; value: number }>();
  for (const o of open) {
    const s = byStage.get(o.stage.name) ?? { stage: o.stage.name, count: 0, value: 0 };
    s.count++;
    s.value += o.value;
    byStage.set(o.stage.name, s);
  }
  const won = closed90.filter((c) => c.stage.isWon).length;
  return {
    pipelineValue: open.reduce((s, o) => s + o.value, 0),
    openOpportunities: open.length,
    byStage: [...byStage.values()],
    wonThisMonth: { count: wonMonth._count, value: wonMonth._sum.value ?? 0 },
    conversion90: closed90.length ? Math.round((won / closed90.length) * 100) : null,
    pendingApproval,
    proposalsOpen,
  };
}

async function documentsExpiring(now: Date) {
  return prisma.document.findMany({
    where: { deletedAt: null, expiresAt: { not: null, lte: new Date(now.getTime() + 30 * DAY) } },
    select: { id: true, title: true, expiresAt: true, category: { select: { name: true } } },
    orderBy: { expiresAt: 'asc' },
    take: 8,
  });
}

async function margins() {
  const orders = await prisma.order.findMany({ where: { deletedAt: null, status: { in: ['READY', 'DELIVERED'] } }, select: { id: true, number: true, client: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 8 });
  return Promise.all(orders.map(async (o) => ({ ...o, ...(await orderMargin(o.id)) })));
}

async function ranking(now: Date) {
  const logs = await prisma.stageLog.groupBy({ by: ['operatorId'], where: { finishedAt: { gte: new Date(now.getTime() - 7 * DAY) }, operatorId: { not: null } }, _sum: { qtyDone: true, qtyRejected: true } });
  const ops = new Map((await prisma.operator.findMany({ select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  return logs
    .map((l) => ({ name: ops.get(l.operatorId!) ?? '-', pieces: l._sum.qtyDone ?? 0, rejected: l._sum.qtyRejected ?? 0 }))
    .sort((a, b) => b.pieces - a.pieces)
    .slice(0, 10);
}

async function myTasks(userId: string, now: Date) {
  const where = { deletedAt: null, assigneeId: userId, status: { in: ['TODO', 'IN_PROGRESS'] as ('TODO' | 'IN_PROGRESS')[] } };
  const [items, overdue] = await Promise.all([
    prisma.task.findMany({ where, orderBy: { dueAt: 'asc' }, take: 8, select: { id: true, title: true, dueAt: true, priority: true } }),
    prisma.task.count({ where: { ...where, dueAt: { lt: now } } }),
  ]);
  return { items, overdue };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/direction', { preHandler: app.guard('reports.viewAll') }, async () => {
    const now = new Date();
    const [prod, qual, stk, com, docs, mrg, rank] = await Promise.all([production(now), quality(now), stock(), commercial(now), documentsExpiring(now), margins(), ranking(now)]);
    return { production: prod, quality: qual, stock: stk, commercial: com, documents: docs, margins: mrg, ranking: rank };
  });

  app.get('/commercial', { preHandler: app.guard('pipeline.view') }, async (req) => {
    const now = new Date();
    const u = req.currentUser!;
    const [com, tasks, clients] = await Promise.all([commercial(now, u.id), myTasks(u.id, now), prisma.client.count({ where: { deletedAt: null, ownerId: u.id } })]);
    return { ...com, tasks, clients };
  });

  app.get('/production', { preHandler: app.guard('production.view') }, async () => {
    const now = new Date();
    const drafts = await prisma.productionOrder.count({ where: { status: 'DRAFT' } });
    const [prod, stk] = await Promise.all([production(now), stock()]);
    return { ...prod, draftOps: drafts, stock: stk };
  });

}
