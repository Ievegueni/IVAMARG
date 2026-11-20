import { operationSchema, phaseSchema, type ListQuery } from '@ivamarg/shared';

import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { nextNumber } from '../../lib/sequence';
import { getSetting } from '../../lib/settings';
import { addTimeline } from '../../lib/timeline';
import { stockOut } from '../stock/core';
import type { PublicUser } from '../users/service';

// Obras e furos partilham a mesma mecânica: fases, consumo de stock, despesas (centro de custo) e orçado vs real.
export type Kind = 'Project' | 'Borehole';
const LABEL: Record<Kind, string> = { Project: 'Obra', Borehole: 'Furo' };
const PREFIX: Record<Kind, string> = { Project: 'OBR', Borehole: 'FUR' };
const SOURCE: Record<Kind, string> = { Project: 'PROJECT', Borehole: 'BOREHOLE' };
type Data = z.output<typeof operationSchema>;

// Delegado Prisma do tipo (mesma forma nos dois modelos).
const model = (k: Kind) => (k === 'Project' ? prisma.project : prisma.borehole) as unknown as typeof prisma.project;
const phaseKey = (k: Kind) => (k === 'Project' ? 'projectId' : 'boreholeId');

export async function list(k: Kind, q: ListQuery & { status?: string; clientId?: string }) {
  const where = {
    deletedAt: null,
    ...(q.status && { status: q.status }),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.search && { OR: [{ number: { contains: q.search, mode: 'insensitive' as const } }, { name: { contains: q.search, mode: 'insensitive' as const } }, { client: { name: { contains: q.search, mode: 'insensitive' as const } } }] }),
  };
  const [items, total] = await Promise.all([
    model(k).findMany({ where, include: { client: { select: { id: true, name: true } }, phases: { select: { progress: true, budget: true } } }, ...pageArgs(q, ['number', 'createdAt', 'startDate'], { createdAt: 'desc' }) }),
    model(k).count({ where }),
  ]);
  return pageResult(items.map((i) => ({ ...i, progress: i.phases.length ? Math.round(i.phases.reduce((s, p) => s + p.progress, 0) / i.phases.length) : 0 })), total, q);
}

/** Orçado vs real: material consumido (custo médio à data da saída) + despesas lançadas neste centro de custo. */
export async function costs(k: Kind, id: string) {
  const [moves, expenses] = await Promise.all([
    prisma.stockMovement.findMany({ where: { sourceType: SOURCE[k], sourceId: id, type: 'OUT' }, include: { item: { select: { code: true, name: true, unit: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.financialEntry.findMany({ where: { deletedAt: null, type: 'EXPENSE', entity: k, entityId: id }, include: { category: { select: { name: true } } }, orderBy: { date: 'asc' } }),
  ]);
  const materials = moves.map((m) => ({ id: m.id, date: m.createdAt, code: m.item.code, name: m.item.name, unit: m.item.unit, quantity: Number(m.quantity), cost: Math.round(Number(m.quantity) * Number(m.unitCost ?? 0)), notes: m.notes }));
  const materialCost = materials.reduce((s, m) => s + m.cost, 0);
  const expenseCost = expenses.reduce((s, e) => s + e.amount, 0);
  return { materials, expenses: expenses.map((e) => ({ id: e.id, date: e.date, category: e.category.name, description: e.description, amount: e.amount })), materialCost, expenseCost, total: materialCost + expenseCost };
}

export async function get(k: Kind, id: string) {
  const o = await model(k).findFirst({ where: { id, deletedAt: null }, include: { client: { select: { id: true, name: true } }, proposal: { select: { id: true, number: true } }, phases: { orderBy: { order: 'asc' } } } });
  if (!o) throw notFound(LABEL[k]);
  const c = await costs(k, id);
  const variance = o.budget - c.total;
  return { ...o, costs: c, variance, variancePct: o.budget ? Math.round((c.total / o.budget) * 1000) / 10 : null };
}

/** Fases iniciais: obra → fases da proposta (se em fases); furo → etapas configuradas. */
export async function defaultPhases(k: Kind, fromProposal?: { description: string; total: number }[]) {
  if (k === 'Project') return (fromProposal ?? []).map((p, i) => ({ name: p.description, order: i + 1, budget: p.total }));
  return (await getSetting<string[]>('boreholes.stages', [])).map((name, i) => ({ name, order: i + 1 }));
}

export async function create(ctx: Ctx, u: PublicUser, k: Kind, d: Data) {
  const { result, gps, ...rest } = d;
  return prisma.$transaction(async (tx) => {
    const phases = await defaultPhases(k);
    const data = { ...rest, ...(k === 'Borehole' ? { gps, result: result ?? {} } : {}), number: await nextNumber(tx, PREFIX[k]), createdById: u.id, phases: { create: phases } };
    const o = await (k === 'Project' ? tx.project.create({ data: data as never }) : tx.borehole.create({ data: data as never }));
    await addTimeline(tx, { clientId: d.clientId, title: `${LABEL[k]} ${o.number} criada: ${o.name}`, userId: u.id, entity: k, entityId: o.id });
    await audit(ctx, { entity: k, entityId: o.id, action: 'create', after: o }, tx);
    return o;
  });
}

export async function update(ctx: Ctx, k: Kind, id: string, d: Partial<Data>) {
  const before = await get(k, id);
  const { result, gps, ...rest } = d;
  const data = { ...rest, ...(k === 'Borehole' && { ...(gps !== undefined && { gps }), ...(result && { result }) }) };
  const after = await model(k).update({ where: { id }, data: data as never });
  if (d.status && d.status !== before.status) {
    await prisma.$transaction((tx) => addTimeline(tx, { clientId: before.clientId, title: `${LABEL[k]} ${before.number}: ${d.status}`, userId: ctx.userId, entity: k, entityId: id }));
  }
  await audit(ctx, { entity: k, entityId: id, action: 'update', before: { ...before, costs: undefined }, after });
  return after;
}

export async function savePhase(ctx: Ctx, k: Kind, opId: string, phaseId: string | null, d: Partial<z.output<typeof phaseSchema>>) {
  await get(k, opId);
  const stamps = {
    ...(d.status === 'IN_PROGRESS' && { startedAt: new Date() }),
    ...(d.status === 'DONE' && { finishedAt: new Date(), progress: 100 }),
  };
  const p = phaseId
    ? await prisma.projectPhase.update({ where: { id: phaseId, [phaseKey(k)]: opId } as never, data: { ...d, ...stamps } })
    : await prisma.projectPhase.create({ data: { ...(d as z.output<typeof phaseSchema>), ...stamps, [phaseKey(k)]: opId } });
  await audit(ctx, { entity: 'ProjectPhase', entityId: p.id, action: phaseId ? 'update' : 'create', after: p });
  return p;
}

/** Consumo de material do stock (saída com origem nesta obra/furo). */
export async function issueMaterials(ctx: Ctx, k: Kind, id: string, warehouseId: string, lines: { itemId: string; quantity: number; notes?: string | null }[]) {
  const o = await get(k, id);
  if (['COMPLETED', 'CANCELLED'].includes(o.status)) throw new AppError(409, 'CLOSED', `${LABEL[k]} concluída ou cancelada`);
  await prisma.$transaction(async (tx) => {
    for (const l of lines) {
      await stockOut(tx, { itemId: l.itemId, warehouseId, quantity: l.quantity, sourceType: SOURCE[k], sourceId: id, notes: l.notes ?? o.number, userId: ctx.userId });
    }
    await audit(ctx, { entity: k, entityId: id, action: 'issue_materials', after: lines }, tx);
  });
  return get(k, id);
}

