import { gridTotal, ORDER_STATUS, orderSchema, type ListQuery } from '@ivamarg/shared';
import type { OrderStatus, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { seesAll } from '../../lib/scope';
import { nextNumber } from '../../lib/sequence';
import { addTimeline } from '../../lib/timeline';
import { emitAutomation } from '../communication/automations';
import type { PublicUser } from '../users/service';

type OrderData = z.output<typeof orderSchema>;
const include = {
  client: { select: { id: true, name: true } },
  proposal: { select: { id: true, number: true } },
  lines: { orderBy: { position: 'asc' as const }, include: { productModel: { select: { id: true, reference: true, name: true } } } },
  productionOrders: { select: { id: true, number: true, status: true }, orderBy: { createdAt: 'asc' as const } },
};

// Sem production.viewAll, só vê encomendas dos clientes da sua carteira.
const scope = (user: PublicUser): Prisma.OrderWhereInput => (seesAll(user, 'production') ? {} : { client: { ownerId: user.id } });

export async function listOrders(user: PublicUser, q: ListQuery & { status?: OrderStatus; clientId?: string }) {
  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    ...scope(user),
    ...(q.status && { status: q.status }),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.search && { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { client: { name: { contains: q.search, mode: 'insensitive' } } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, include: { client: { select: { id: true, name: true } } }, ...pageArgs(q, ['number', 'deadline', 'createdAt', 'total'], { createdAt: 'desc' }) }),
    prisma.order.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function getOrder(user: PublicUser, id: string) {
  const o = await prisma.order.findFirst({ where: { id, deletedAt: null, ...scope(user) }, include });
  if (!o) throw notFound('Encomenda');
  return o;
}

/** Quantidade da linha = soma da grelha de tamanhos (ou quantidade indicada se não houver grelha). */
function linesData(lines: OrderData['lines']) {
  const rows = lines.map((l, i) => {
    const quantity = Object.keys(l.sizeGrid).length ? gridTotal(l.sizeGrid) : (l.quantity ?? 0);
    return { position: i + 1, description: l.description, productModelId: l.productModelId, sizeGrid: l.sizeGrid, color: l.color, details: l.details, quantity, unitPrice: l.unitPrice, total: quantity * l.unitPrice };
  });
  return { rows, total: rows.reduce((s, r) => s + r.total, 0) };
}

export async function createOrder(ctx: Ctx, user: PublicUser, d: OrderData) {
  const { rows, total } = linesData(d.lines);
  const { lines: _l, ...header } = d;
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.create({ data: { ...header, number: await nextNumber(tx, 'ENC'), total, createdById: user.id, lines: { create: rows } }, include });
    await addTimeline(tx, { clientId: d.clientId, title: `Encomenda ${o.number} criada`, userId: user.id, entity: 'Order', entityId: o.id });
    await audit(ctx, { entity: 'Order', entityId: o.id, action: 'create', after: o }, tx);
    return o;
  });
}

// Depois de entrar em produção, as linhas ficam fechadas (alterações passam pela OP no S2).
const LINES_LOCKED: OrderStatus[] = ['IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED'];

export async function updateOrder(ctx: Ctx, user: PublicUser, id: string, d: Partial<OrderData>) {
  const before = await getOrder(user, id);
  if (d.lines && LINES_LOCKED.includes(before.status)) {
    throw new AppError(409, 'ORDER_LOCKED', `Linhas não editáveis com a encomenda em "${ORDER_STATUS[before.status]}"`);
  }
  if (d.clientId && d.clientId !== before.clientId && before.proposalId) {
    throw new AppError(400, 'CLIENT_LOCKED', 'Encomenda gerada de proposta: o cliente não pode ser alterado');
  }
  if (d.lines && before.productionOrders.some((p) => p.status !== 'CANCELLED')) {
    throw new AppError(409, 'ORDER_LOCKED', 'A encomenda já tem ordens de produção: as linhas não podem ser alteradas');
  }
  const { lines, ...header } = d;
  return prisma.$transaction(async (tx) => {
    let total: number | undefined;
    if (lines) {
      const data = linesData(lines);
      total = data.total;
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await tx.orderLine.createMany({ data: data.rows.map((r) => ({ ...r, orderId: id })) });
    }
    const after = await tx.order.update({ where: { id }, data: { ...header, ...(total !== undefined && { total }) }, include });
    if (d.status && d.status !== before.status) {
      await addTimeline(tx, { clientId: after.clientId, title: `Encomenda ${after.number}: ${ORDER_STATUS[d.status]}`, userId: user.id, entity: 'Order', entityId: id });
    }
    await audit(ctx, { entity: 'Order', entityId: id, action: 'update', before, after }, tx);
    return after;
  }).then(async (after) => {
    if (d.status === 'READY' && before.status !== 'READY') await emitAutomation('ORDER_READY', { orderId: id });
    return after;
  });
}
