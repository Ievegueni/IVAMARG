import type { ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { notify, usersWithPermission } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { seesAll } from '../../lib/scope';
import type { PublicUser } from '../users/service';
import { prisma } from '../../lib/prisma';
import { nextNumber } from '../../lib/sequence';
import { getSetting } from '../../lib/settings';
import { addTimeline } from '../../lib/timeline';
import { emitAutomation } from '../communication/automations';
import { D, release, reserve, stockOut } from '../stock/core';
import { computeRequirements, costSummary, deviationPct, labourCost, lotFlow, margin, pieceRate, splitLots } from './calc';

type Tx = Prisma.TransactionClient;
const NO_SIZE = 'ÚNICO';
const gridOf = (l: { sizeGrid: unknown; quantity: number }) => {
  const g = Object.fromEntries(Object.entries((l.sizeGrid ?? {}) as Record<string, number>).filter(([, n]) => n > 0));
  return Object.keys(g).length ? g : l.quantity > 0 ? { [NO_SIZE]: l.quantity } : {};
};
const activeStages = () => prisma.productionStage.findMany({ where: { active: true }, orderBy: { order: 'asc' } });

// ─── Criação a partir da encomenda ───

/** Gera OP(s) em rascunho para as linhas ainda sem OP (1 por encomenda ou por linha, conforme configuração). */
export async function createFromOrder(ctx: Ctx, orderId: string, warehouseId?: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { lines: { orderBy: { position: 'asc' }, include: { poItems: { include: { productionOrder: { select: { status: true } } } } } } },
  });
  if (!order) throw notFound('Encomenda');
  if (['DELIVERED', 'CANCELLED'].includes(order.status)) throw new AppError(409, 'INVALID_STATUS', 'Encomenda entregue ou cancelada');
  const pending = order.lines.filter((l) => !l.poItems.some((i) => i.productionOrder.status !== 'CANCELLED'));
  if (!pending.length) throw new AppError(409, 'NOTHING_TO_PRODUCE', 'Todas as linhas já têm ordem de produção');
  const missing = pending.filter((l) => !l.productModelId);
  if (missing.length) throw new AppError(400, 'MODEL_REQUIRED', `Associe um modelo do catálogo às linhas: ${missing.map((l) => l.description).join(', ')}`);
  const empty = pending.filter((l) => !Object.keys(gridOf(l)).length);
  if (empty.length) throw new AppError(400, 'EMPTY_LINE', `Linhas sem quantidades: ${empty.map((l) => l.description).join(', ')}`);

  // Por defeito, o armazém principal (o mais antigo); a UI permite escolher outro.
  const wh = warehouseId ?? (await prisma.warehouse.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } }))?.id;
  if (!wh) throw new AppError(400, 'NO_WAREHOUSE', 'Configure um armazém');
  const mode = await getSetting('production.opMode', 'PER_ORDER');
  const groups = mode === 'PER_LINE' ? pending.map((l) => [l]) : [pending];

  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const lines of groups) {
      const po = await tx.productionOrder.create({
        data: {
          number: await nextNumber(tx, 'OP'),
          orderId,
          warehouseId: wh,
          createdById: ctx.userId,
          items: { create: lines.map((l) => ({ orderLineId: l.id, productModelId: l.productModelId!, sizeGrid: gridOf(l), quantity: l.quantity })) },
        },
      });
      await audit(ctx, { entity: 'ProductionOrder', entityId: po.id, action: 'create', after: po }, tx);
      created.push(po);
    }
    await addTimeline(tx, { clientId: order.clientId, title: `Encomenda ${order.number}: ${created.map((p) => p.number).join(', ')} criada(s)`, userId: ctx.userId, entity: 'Order', entityId: orderId });
    return created;
  });
}

// ─── Consulta ───

export async function listPOs(u: PublicUser, q: ListQuery & { status?: string; orderId?: string }) {
  const where: Prisma.ProductionOrderWhereInput = {
    // Sem production.viewAll: só OPs de encomendas de clientes da sua carteira.
    ...(!seesAll(u, 'production') && { order: { client: { ownerId: u.id } } }),
    ...(q.status && { status: q.status as never }),
    ...(q.orderId && { orderId: q.orderId }),
    ...(q.search && { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { order: { number: { contains: q.search, mode: 'insensitive' } } }, { order: { client: { name: { contains: q.search, mode: 'insensitive' } } } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: { order: { select: { number: true, deadline: true, priority: true, client: { select: { name: true } } } }, _count: { select: { lots: true } }, items: { select: { quantity: true } } },
      ...pageArgs(q, ['number', 'createdAt'], { createdAt: 'desc' }),
    }),
    prisma.productionOrder.count({ where }),
  ]);
  return pageResult(items.map((p) => ({ ...p, quantity: p.items.reduce((s, i) => s + i.quantity, 0) })), total, q);
}

/** Necessidades teóricas da OP (BOM actual) vs disponível no armazém. */
async function needs(po: { warehouseId: string; items: { productModelId: string; sizeGrid: unknown }[] }) {
  const bom = await prisma.bomLine.findMany({ where: { productModelId: { in: po.items.map((i) => i.productModelId) } } });
  const req = computeRequirements(po.items.map((i) => ({ productModelId: i.productModelId, sizeGrid: i.sizeGrid as Record<string, number> })), bom);
  const items = await prisma.stockItem.findMany({ where: { id: { in: [...req.keys()] } }, include: { levels: { where: { warehouseId: po.warehouseId } } } });
  return items.map((i) => {
    const required = req.get(i.id)!;
    const lvl = i.levels[0];
    const available = lvl ? D(lvl.onHand).minus(lvl.reserved).toNumber() : 0;
    return { itemId: i.id, code: i.code, name: i.name, unit: i.unit, required, available, shortage: Math.max(0, Math.round((required - available) * 1000) / 1000) };
  });
}

export async function getPO(id: string) {
  const po = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, number: true, deadline: true, priority: true, total: true, personalizationName: true, personalizationNotes: true, notes: true, client: { select: { id: true, name: true } } } },
      items: { include: { productModel: { select: { id: true, reference: true, name: true } }, orderLine: { select: { description: true, unitPrice: true, color: true, details: true } } } },
      requirements: { include: { item: { select: { code: true, name: true, unit: true } } } },
      lots: {
        orderBy: { number: 'asc' },
        include: {
          productModel: { select: { reference: true, name: true } },
          logs: { orderBy: { startedAt: 'asc' }, include: { stage: { select: { name: true, type: true } }, operator: { select: { name: true } }, supplier: { select: { name: true } }, defects: { include: { defectType: { select: { name: true } } } } } },
        },
      },
    },
  });
  if (!po) throw notFound('Ordem de produção');
  const stages = await activeStages();
  const lots = po.lots.map((l) => {
    const f = lotFlow(l.quantity, stages, l.logs);
    return { ...l, finished: f.finished, scrapped: f.scrapped, complete: f.complete, flow: stages.map((s) => ({ stageId: s.id, ...f.flow.get(s.id)! })) };
  });
  const material = po.requirements.reduce((s, r) => s + r.issuedCost, 0);
  const allLogs = po.lots.flatMap((l) => l.logs);
  const costs = costSummary({
    material,
    labour: allLogs.reduce((s, l) => s + l.labourCost, 0),
    external: allLogs.reduce((s, l) => s + l.cost, 0),
    pieces: lots.reduce((s, l) => s + l.finished, 0),
  });
  const consumption = po.requirements.map((r) => ({
    itemId: r.itemId,
    ...r.item,
    required: Number(r.required),
    reserved: Number(r.reserved),
    issued: Number(r.issued),
    issuedCost: r.issuedCost,
    deviationPct: deviationPct(Number(r.required), Number(r.issued)),
  }));
  return {
    ...po,
    stages: stages.map((s) => ({ id: s.id, name: s.name, type: s.type, order: s.order })),
    lots,
    costs,
    consumption,
    shortages: po.status === 'DRAFT' ? await needs(po) : [],
    quantity: po.items.reduce((s, i) => s + i.quantity, 0),
  };
}

// ─── Libertação: reserva de material e lotes ───

export async function releasePO(ctx: Ctx, id: string, force: boolean) {
  const po = await prisma.productionOrder.findUnique({ where: { id }, include: { items: true, order: { select: { number: true, clientId: true, status: true } } } });
  if (!po) throw notFound('Ordem de produção');
  if (po.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATUS', 'Só OPs em rascunho podem ser libertadas');
  const reqs = await needs(po);
  const short = reqs.filter((r) => r.shortage > 0);
  if (short.length) {
    await notify(await usersWithPermission('stock.edit'), {
      title: `Material insuficiente para ${po.number}`,
      body: short.map((s) => `${s.code}: faltam ${s.shortage} ${s.unit}`).join(' · '),
      link: `/producao/ops/${id}`,
    });
    if (!force) throw new AppError(409, 'SHORTAGE', 'Material insuficiente. Pode libertar na mesma (reserva o disponível) ou aguardar compra.', short);
  }
  const lotSize = await getSetting('production.lotSize', 50);
  await prisma.$transaction(async (tx) => {
    for (const r of reqs) {
      const toReserve = Math.min(r.required, Math.max(0, r.available));
      if (toReserve > 0) await reserve(tx, { itemId: r.itemId, warehouseId: po.warehouseId, quantity: toReserve, sourceType: 'PRODUCTION_ORDER', sourceId: id, userId: ctx.userId });
      await tx.materialRequirement.create({ data: { productionOrderId: id, itemId: r.itemId, required: r.required, reserved: toReserve } });
    }
    let n = 0;
    for (const item of po.items) {
      for (const lot of splitLots(item.sizeGrid as Record<string, number>, lotSize)) {
        n++;
        await tx.lot.create({
          data: {
            productionOrderId: id,
            productModelId: item.productModelId,
            size: lot.size === NO_SIZE ? null : lot.size,
            quantity: lot.quantity,
            number: `${po.number}-L${String(n).padStart(2, '0')}`,
            qrToken: randomBytes(9).toString('base64url'),
          },
        });
      }
    }
    await tx.productionOrder.update({ where: { id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    if (['DRAFT', 'CONFIRMED'].includes(po.order.status)) await tx.order.update({ where: { id: po.orderId }, data: { status: 'IN_PRODUCTION' } });
    await addTimeline(tx, { clientId: po.order.clientId, title: `${po.number} libertada para produção (${n} lotes)`, userId: ctx.userId, entity: 'ProductionOrder', entityId: id });
    await audit(ctx, { entity: 'ProductionOrder', entityId: id, action: force && short.length ? 'release_forced' : 'release', after: { requirements: reqs, lots: n } }, tx);
  });
  return getPO(id);
}

// ─── Saída de material para a OP (consumo real) ───

export async function issueMaterials(ctx: Ctx, id: string, lines: { itemId: string; quantity: number }[]) {
  await prisma.$transaction(async (tx) => {
    const [po] = await tx.$queryRaw<{ status: string; warehouseId: string; number: string }[]>`SELECT status, "warehouseId", number FROM "ProductionOrder" WHERE id = ${id} FOR UPDATE`;
    if (!po) throw notFound('Ordem de produção');
    if (po.status !== 'RELEASED') throw new AppError(409, 'INVALID_STATUS', 'Só é possível dar saída de material para OPs libertadas');
    for (const l of lines) {
      const req =
        (await tx.materialRequirement.findUnique({ where: { productionOrderId_itemId: { productionOrderId: id, itemId: l.itemId } } })) ??
        (await tx.materialRequirement.create({ data: { productionOrderId: id, itemId: l.itemId, required: 0 } })); // material fora da BOM
      const out = await stockOut(tx, { itemId: l.itemId, warehouseId: po.warehouseId, quantity: l.quantity, fromReserved: req.reserved, sourceType: 'PRODUCTION_ORDER', sourceId: id, notes: po.number, userId: ctx.userId });
      await tx.materialRequirement.update({
        where: { id: req.id },
        data: { issued: D(req.issued).plus(l.quantity), issuedCost: req.issuedCost + out.cost, reserved: D(req.reserved).minus(out.reservedUsed) },
      });
    }
    await audit(ctx, { entity: 'ProductionOrder', entityId: id, action: 'issue', after: lines }, tx);
  });
  return getPO(id);
}

async function releaseLeftovers(tx: Tx, ctx: Ctx, poId: string, warehouseId: string) {
  const reqs = await tx.materialRequirement.findMany({ where: { productionOrderId: poId, reserved: { gt: 0 } } });
  for (const r of reqs) {
    await release(tx, { itemId: r.itemId, warehouseId, quantity: r.reserved, sourceType: 'PRODUCTION_ORDER', sourceId: poId, userId: ctx.userId });
    await tx.materialRequirement.update({ where: { id: r.id }, data: { reserved: 0 } });
  }
}

export async function completePO(ctx: Ctx, id: string) {
  const po = await getPO(id);
  if (po.status !== 'RELEASED') throw new AppError(409, 'INVALID_STATUS', 'Só OPs libertadas podem ser concluídas');
  const open = po.lots.filter((l) => l.status === 'OPEN' && !l.complete);
  if (open.length) throw new AppError(409, 'LOTS_OPEN', `Lotes por concluir: ${open.map((l) => l.number).join(', ')}`);
  const ready = await prisma.$transaction(async (tx) => {
    await releaseLeftovers(tx, ctx, id, po.warehouseId);
    await tx.productionOrder.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const remaining = await tx.productionOrder.count({ where: { orderId: po.orderId, status: { in: ['DRAFT', 'RELEASED'] } } });
    if (!remaining) {
      await tx.order.update({ where: { id: po.orderId }, data: { status: 'READY' } });
      await addTimeline(tx, { clientId: po.order.client.id, title: `Encomenda ${po.order.number} pronta`, userId: ctx.userId, entity: 'Order', entityId: po.orderId });
    }
    await audit(ctx, { entity: 'ProductionOrder', entityId: id, action: 'complete', after: po.costs }, tx);
    return !remaining;
  });
  if (ready) await emitAutomation('ORDER_READY', { orderId: po.orderId });
  return getPO(id);
}

export async function cancelPO(ctx: Ctx, id: string) {
  const po = await prisma.productionOrder.findUnique({ where: { id } });
  if (!po) throw notFound('Ordem de produção');
  if (!['DRAFT', 'RELEASED'].includes(po.status)) throw new AppError(409, 'INVALID_STATUS', 'OP já concluída ou cancelada');
  await prisma.$transaction(async (tx) => {
    await releaseLeftovers(tx, ctx, id, po.warehouseId);
    await tx.lot.updateMany({ where: { productionOrderId: id, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    await tx.productionOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(ctx, { entity: 'ProductionOrder', entityId: id, action: 'cancel' }, tx);
  });
  return getPO(id);
}

// ─── Etapas (escritório e chão de fábrica usam as mesmas funções) ───

export type Actor = Ctx & { operatorId?: string };

async function lockLot(tx: Tx, lotId: string) {
  const [lot] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Lot" WHERE id = ${lotId} FOR UPDATE`;
  if (!lot) throw notFound('Lote');
  return tx.lot.findUniqueOrThrow({ where: { id: lotId }, include: { logs: true, productionOrder: { select: { status: true } } } });
}

export async function startStage(actor: Actor, d: { lotId: string; stageId: string; quantity: number; operatorId?: string | null; supplierId?: string | null; notes?: string | null }) {
  const operatorId = actor.operatorId ?? d.operatorId ?? null;
  return prisma.$transaction(async (tx) => {
    const lot = await lockLot(tx, d.lotId);
    if (lot.status !== 'OPEN' || lot.productionOrder.status !== 'RELEASED') throw new AppError(409, 'LOT_CLOSED', 'Lote fechado ou OP não libertada');
    const stages = await tx.productionStage.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
    const stage = stages.find((s) => s.id === d.stageId);
    if (!stage) throw new AppError(400, 'INVALID_STAGE', 'Etapa inválida');
    if (stage.type === 'EXTERNAL' && !d.supplierId) throw new AppError(400, 'SUPPLIER_REQUIRED', 'Etapa externa: indique o fornecedor');
    if (stage.type === 'INTERNAL' && !operatorId) throw new AppError(400, 'OPERATOR_REQUIRED', 'Indique o operador');
    const available = lotFlow(lot.quantity, stages, lot.logs).flow.get(stage.id)!.available;
    if (d.quantity > available) {
      throw new AppError(409, 'NOT_AVAILABLE', available ? `Só há ${available} peça(s) disponíveis para ${stage.name}` : `Ainda não há peças disponíveis para ${stage.name} (etapa anterior por concluir)`);
    }
    const log = await tx.stageLog.create({
      data: { lotId: lot.id, stageId: stage.id, qtyIn: d.quantity, operatorId, supplierId: stage.type === 'EXTERNAL' ? d.supplierId : null, notes: d.notes, userId: actor.userId },
    });
    await audit(actor, { entity: 'StageLog', entityId: log.id, action: 'start', after: log }, tx);
    return log;
  });
}

export async function finishStage(
  actor: Actor,
  logId: string,
  d: { qtyDone: number; qtyRejected: number; qtyRework: number; reworkStageId?: string | null; cost: number; defects: { defectTypeId: string; quantity: number }[]; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const log0 = await tx.stageLog.findUnique({ where: { id: logId } });
    if (!log0) throw notFound('Registo');
    const lot = await lockLot(tx, log0.lotId);
    const log = lot.logs.find((l) => l.id === logId)!;
    if (log.finishedAt) throw new AppError(409, 'ALREADY_FINISHED', 'Etapa já concluída');
    if (actor.operatorId && log.operatorId && log.operatorId !== actor.operatorId) throw new AppError(403, 'FORBIDDEN', 'Este registo pertence a outro operador');
    const stage = await tx.productionStage.findUniqueOrThrow({ where: { id: log.stageId } });
    const isQ = stage.type === 'QUALITY';
    const rework = isQ ? d.qtyRework : 0;
    if (d.qtyDone + d.qtyRejected + rework !== log.qtyIn) {
      throw new AppError(400, 'QTY_MISMATCH', `As quantidades têm de somar ${log.qtyIn} (${isQ ? 'aprovadas + refugo + retrabalho' : 'concluídas + rejeitadas'})`);
    }
    if (rework) {
      const target = d.reworkStageId ? await tx.productionStage.findUnique({ where: { id: d.reworkStageId } }) : null;
      if (!target || !target.active || target.order >= stage.order) throw new AppError(400, 'INVALID_REWORK_STAGE', 'Escolha uma etapa anterior para o retrabalho');
    }
    const defectTotal = d.defects.reduce((s, x) => s + x.quantity, 0);
    if (defectTotal > d.qtyRejected + rework) throw new AppError(400, 'DEFECTS_EXCEED', 'Defeitos registados excedem as peças rejeitadas/retrabalho');

    const op = log.operatorId ? await tx.operator.findUnique({ where: { id: log.operatorId } }) : null;
    const rates = await tx.stageRate.findMany({ where: { stageId: stage.id } });
    const after = await tx.stageLog.update({
      where: { id: logId },
      data: {
        qtyDone: d.qtyDone,
        qtyRejected: d.qtyRejected,
        qtyRework: rework,
        reworkStageId: rework ? d.reworkStageId : null,
        cost: stage.type === 'EXTERNAL' ? d.cost : 0,
        labourCost: labourCost(op?.payModel, d.qtyDone, pieceRate(rates, stage.id, lot.productModelId)),
        finishedAt: new Date(),
        notes: d.notes ?? log.notes,
        defects: { create: d.defects },
      },
    });
    const stages = await tx.productionStage.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
    const flow = lotFlow(lot.quantity, stages, lot.logs.map((l) => (l.id === logId ? after : l)));
    if (flow.complete) await tx.lot.update({ where: { id: lot.id }, data: { status: 'COMPLETED' } });
    await audit(actor, { entity: 'StageLog', entityId: logId, action: 'finish', before: log, after }, tx);
    return { log: after, lotComplete: flow.complete };
  });
}

// ─── Margem e pagamento à peça ───

export async function orderMargin(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { total: true } });
  if (!order) throw notFound('Encomenda');
  const pos = await prisma.productionOrder.findMany({ where: { orderId, status: { not: 'CANCELLED' } }, select: { id: true } });
  const costs = await Promise.all(pos.map((p) => getPO(p.id).then((x) => x.costs)));
  const total = costs.reduce((s, c) => s + c.total, 0);
  const minPct = await getSetting('production.minMarginPct', 0);
  return { sale: order.total, cost: total, ...margin(order.total, total, minPct), minPct, pieces: costs.reduce((s, c) => s + c.pieces, 0) };
}

export async function piecePay(from: Date, to: Date) {
  const logs = await prisma.stageLog.findMany({
    where: { finishedAt: { gte: from, lte: to }, operatorId: { not: null } },
    include: { stage: { select: { name: true } } },
  });
  const ops = await prisma.operator.findMany({ include: { section: { select: { name: true } } }, orderBy: { name: 'asc' } });
  return ops
    .map((o) => {
      const mine = logs.filter((l) => l.operatorId === o.id);
      const byStage = new Map<string, { stage: string; pieces: number; amount: number }>();
      for (const l of mine) {
        const s = byStage.get(l.stageId) ?? { stage: l.stage.name, pieces: 0, amount: 0 };
        s.pieces += l.qtyDone;
        s.amount += l.labourCost;
        byStage.set(l.stageId, s);
      }
      const pieceAmount = mine.reduce((s, l) => s + l.labourCost, 0);
      const fixed = o.payModel === 'PIECE' ? 0 : o.fixedSalary;
      return {
        operatorId: o.id,
        name: o.name,
        code: o.code,
        section: o.section?.name ?? null,
        payModel: o.payModel,
        pieces: mine.reduce((s, l) => s + l.qtyDone, 0),
        rejected: mine.reduce((s, l) => s + l.qtyRejected, 0),
        pieceAmount,
        fixed,
        total: pieceAmount + fixed,
        byStage: [...byStage.values()],
      };
    })
    .filter((r) => r.pieces || r.fixed || r.rejected);
}
