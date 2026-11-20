import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors';

// Núcleo de stock. Todas as funções correm dentro de uma transacção e bloqueiam as linhas
// envolvidas (SELECT … FOR UPDATE) para que movimentos concorrentes não corrompam saldos.

type Tx = Prisma.TransactionClient;
type Dec = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export type Source = { sourceType: string; sourceId?: string | null; notes?: string | null; userId?: string | null };
type Base = { itemId: string; warehouseId: string; quantity: Prisma.Decimal.Value } & Source;

async function lockItem(tx: Tx, itemId: string) {
  const [item] = await tx.$queryRaw<{ id: string; code: string; name: string; avgCost: Dec; unit: string }[]>`
    SELECT id, code, name, "avgCost", unit FROM "StockItem" WHERE id = ${itemId} FOR UPDATE`;
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Artigo de stock não encontrado');
  return item;
}

async function lockLevel(tx: Tx, itemId: string, warehouseId: string) {
  await tx.stockLevel.upsert({ where: { itemId_warehouseId: { itemId, warehouseId } }, create: { itemId, warehouseId }, update: {} });
  const [lvl] = await tx.$queryRaw<{ id: string; onHand: Dec; reserved: Dec }[]>`
    SELECT id, "onHand", reserved FROM "StockLevel" WHERE "itemId" = ${itemId} AND "warehouseId" = ${warehouseId} FOR UPDATE`;
  return { id: lvl.id, onHand: D(lvl.onHand), reserved: D(lvl.reserved) };
}

function positive(q: Prisma.Decimal.Value) {
  const d = D(q);
  if (d.lte(0)) throw new AppError(400, 'INVALID_QUANTITY', 'A quantidade tem de ser maior que zero');
  return d;
}

const insufficient = (item: { code: string; name: string; unit: string }, available: Dec, wanted: Dec) =>
  new AppError(409, 'INSUFFICIENT_STOCK', `Stock insuficiente de ${item.code} - ${item.name}: disponível ${available.toString()} ${item.unit}, pedido ${wanted.toString()}`, {
    itemCode: item.code,
    available: available.toNumber(),
    requested: wanted.toNumber(),
  });

const movement = (tx: Tx, type: Prisma.StockMovementCreateArgs['data']['type'], b: Omit<Base, 'quantity'> & { quantity: Dec; unitCost?: Dec | null; toWarehouseId?: string }) =>
  tx.stockMovement.create({
    data: {
      type,
      itemId: b.itemId,
      warehouseId: b.warehouseId,
      toWarehouseId: b.toWarehouseId,
      quantity: b.quantity,
      unitCost: b.unitCost,
      sourceType: b.sourceType,
      sourceId: b.sourceId,
      notes: b.notes,
      userId: b.userId,
    },
  });

/** Custo médio ponderado após entrada de `qty` a `cost`, sobre o físico total do artigo (todos os armazéns). */
export function weightedAverage(onHandTotal: Dec, avg: Dec, qty: Dec, cost: Dec) {
  if (onHandTotal.lte(0)) return cost;
  return onHandTotal.mul(avg).plus(qty.mul(cost)).div(onHandTotal.plus(qty)).toDecimalPlaces(4);
}

/** Entrada (compra, devolução). Recalcula o custo médio ponderado. */
export async function stockIn(tx: Tx, b: Base & { unitCost: Prisma.Decimal.Value }) {
  const qty = positive(b.quantity);
  const cost = D(b.unitCost);
  const item = await lockItem(tx, b.itemId);
  const lvl = await lockLevel(tx, b.itemId, b.warehouseId);
  const total = await tx.stockLevel.aggregate({ where: { itemId: b.itemId }, _sum: { onHand: true } });
  const avg = weightedAverage(D(total._sum.onHand ?? 0), D(item.avgCost), qty, cost);
  await tx.stockItem.update({ where: { id: b.itemId }, data: { avgCost: avg } });
  await tx.stockLevel.update({ where: { id: lvl.id }, data: { onHand: lvl.onHand.plus(qty) } });
  return movement(tx, 'IN', { ...b, quantity: qty, unitCost: cost });
}

/**
 * Saída (consumo). `fromReserved` = quanto desta saída consome reserva existente (ex.: OP);
 * o resto tem de caber no disponível. Devolve o custo (Kz) ao custo médio actual.
 */
export async function stockOut(tx: Tx, b: Base & { fromReserved?: Prisma.Decimal.Value }) {
  const qty = positive(b.quantity);
  const item = await lockItem(tx, b.itemId);
  const lvl = await lockLevel(tx, b.itemId, b.warehouseId);
  const reservedUsed = Prisma.Decimal.min(D(b.fromReserved ?? 0), lvl.reserved, qty);
  const free = qty.minus(reservedUsed);
  const available = lvl.onHand.minus(lvl.reserved);
  if (free.gt(available)) throw insufficient(item, available.plus(reservedUsed), qty);
  await tx.stockLevel.update({ where: { id: lvl.id }, data: { onHand: lvl.onHand.minus(qty), reserved: lvl.reserved.minus(reservedUsed) } });
  await movement(tx, 'OUT', { ...b, quantity: qty, unitCost: D(item.avgCost) });
  return { cost: Math.round(qty.mul(item.avgCost).toNumber()), reservedUsed };
}

export async function reserve(tx: Tx, b: Base) {
  const qty = positive(b.quantity);
  const item = await lockItem(tx, b.itemId);
  const lvl = await lockLevel(tx, b.itemId, b.warehouseId);
  const available = lvl.onHand.minus(lvl.reserved);
  if (qty.gt(available)) throw insufficient(item, available, qty);
  await tx.stockLevel.update({ where: { id: lvl.id }, data: { reserved: lvl.reserved.plus(qty) } });
  return movement(tx, 'RESERVE', { ...b, quantity: qty });
}

export async function release(tx: Tx, b: Base) {
  const qty = positive(b.quantity);
  await lockItem(tx, b.itemId);
  const lvl = await lockLevel(tx, b.itemId, b.warehouseId);
  if (qty.gt(lvl.reserved)) throw new AppError(409, 'INVALID_RELEASE', 'Não é possível libertar mais do que está reservado');
  await tx.stockLevel.update({ where: { id: lvl.id }, data: { reserved: lvl.reserved.minus(qty) } });
  return movement(tx, 'RELEASE', { ...b, quantity: qty });
}

export async function transfer(tx: Tx, b: Base & { toWarehouseId: string }) {
  const qty = positive(b.quantity);
  if (b.toWarehouseId === b.warehouseId) throw new AppError(400, 'SAME_WAREHOUSE', 'Armazém de origem e destino iguais');
  const item = await lockItem(tx, b.itemId);
  // Ordem fixa de bloqueio (por id de armazém) para evitar deadlocks entre transferências cruzadas.
  const [a, z] = [b.warehouseId, b.toWarehouseId].sort();
  const la = await lockLevel(tx, b.itemId, a);
  const lz = await lockLevel(tx, b.itemId, z);
  const [from, to] = a === b.warehouseId ? [la, lz] : [lz, la];
  const available = from.onHand.minus(from.reserved);
  if (qty.gt(available)) throw insufficient(item, available, qty);
  await tx.stockLevel.update({ where: { id: from.id }, data: { onHand: from.onHand.minus(qty) } });
  await tx.stockLevel.update({ where: { id: to.id }, data: { onHand: to.onHand.plus(qty) } });
  return movement(tx, 'TRANSFER', { ...b, quantity: qty, unitCost: D(item.avgCost) });
}

/** Ajuste (inventário / correcção): delta com sinal. O físico não pode ficar abaixo do reservado nem negativo. */
export async function adjust(tx: Tx, b: Omit<Base, 'quantity'> & { delta: Prisma.Decimal.Value }) {
  const delta = D(b.delta);
  if (delta.isZero()) return null;
  const item = await lockItem(tx, b.itemId);
  const lvl = await lockLevel(tx, b.itemId, b.warehouseId);
  const next = lvl.onHand.plus(delta);
  if (next.lt(0) || next.lt(lvl.reserved)) {
    throw new AppError(409, 'INVALID_ADJUSTMENT', `Ajuste deixaria ${item.code} com físico ${next.toString()} abaixo do reservado (${lvl.reserved.toString()})`);
  }
  await tx.stockLevel.update({ where: { id: lvl.id }, data: { onHand: next } });
  return movement(tx, 'ADJUSTMENT', { ...b, quantity: delta, unitCost: D(item.avgCost) });
}
