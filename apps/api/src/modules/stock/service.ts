import { inventoryCountsSchema, manualMovementSchema, purchaseSchema, stockItemSchema, type ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { nextNumber } from '../../lib/sequence';
import { adjust, D, stockIn, stockOut, transfer } from './core';

// ─── Artigos e saldos ───

/** Próximo código numérico de artigo: maior código só com dígitos + 1, com zeros à esquerda (mín. 3 dígitos). Conta também os apagados (o código é único). */
export async function nextItemCode() {
  const rows = await prisma.$queryRaw<{ max: bigint | null; len: number | null }[]>`
    SELECT MAX(code::bigint) AS max, MAX(LENGTH(code)) AS len FROM "StockItem" WHERE code ~ '^[0-9]{1,18}$'`;
  const next = Number(rows[0]?.max ?? 0) + 1;
  return String(next).padStart(Math.max(3, rows[0]?.len ?? 3), '0');
}

export async function listItems(q: ListQuery & { category?: string; belowMin?: boolean; warehouseId?: string }) {
  const where: Prisma.StockItemWhereInput = {
    deletedAt: null,
    ...(q.category && { category: q.category as never }),
    ...(q.search && { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }),
  };
  const items = await prisma.stockItem.findMany({
    where,
    include: { levels: { include: { warehouse: { select: { id: true, code: true, name: true } } } } },
    ...pageArgs(q.belowMin ? { ...q, page: 1, pageSize: 10_000 } : q, ['code', 'name'], { code: 'asc' }),
  });
  const rows = items.map((i) => {
    const levels = q.warehouseId ? i.levels.filter((l) => l.warehouseId === q.warehouseId) : i.levels;
    const onHand = levels.reduce((s, l) => s.plus(l.onHand), D(0));
    const reserved = levels.reduce((s, l) => s.plus(l.reserved), D(0));
    const available = onHand.minus(reserved);
    return { ...i, onHand: onHand.toNumber(), reserved: reserved.toNumber(), available: available.toNumber(), belowMin: available.lt(i.minStock) && D(i.minStock).gt(0) };
  });
  if (q.belowMin) {
    // ponytail: filtro em memória (catálogo de stock pequeno); passar a SQL se crescer para milhares.
    const filtered = rows.filter((r) => r.belowMin);
    return pageResult(filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), filtered.length, q);
  }
  return pageResult(rows, await prisma.stockItem.count({ where }), q);
}

export async function listMovements(q: ListQuery & { itemId?: string; warehouseId?: string; type?: string; sourceType?: string; sourceId?: string }) {
  const where: Prisma.StockMovementWhereInput = {
    ...(q.itemId && { itemId: q.itemId }),
    ...(q.warehouseId && { OR: [{ warehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }] }),
    ...(q.type && { type: q.type as never }),
    ...(q.sourceType && { sourceType: q.sourceType }),
    ...(q.sourceId && { sourceId: q.sourceId }),
  };
  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: { item: { select: { code: true, name: true, unit: true } }, warehouse: { select: { code: true } }, toWarehouse: { select: { code: true } } },
      ...pageArgs(q, ['createdAt'], { createdAt: 'desc' }),
    }),
    prisma.stockMovement.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function manualMovement(ctx: Ctx, d: z.output<typeof manualMovementSchema>) {
  const src = { sourceType: 'MANUAL', notes: d.notes, userId: ctx.userId };
  return prisma.$transaction(async (tx) => {
    const m =
      d.type === 'IN' ? await stockIn(tx, { ...d, ...src })
      : d.type === 'OUT' ? await stockOut(tx, { ...d, ...src }).then(() => null)
      : d.type === 'TRANSFER' ? await transfer(tx, { ...d, ...src })
      : await adjust(tx, { ...d, ...src });
    await audit(ctx, { entity: 'StockMovement', entityId: m?.id, action: d.type.toLowerCase(), after: d }, tx);
    return { ok: true };
  });
}

// ─── Compras ───

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  lines: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
};

function purchaseLines(lines: z.output<typeof purchaseSchema>['lines']) {
  const rows = lines.map((l) => ({ ...l, total: Math.round(l.quantity * l.unitCost) }));
  return { rows, total: rows.reduce((s, r) => s + r.total, 0) };
}

export async function createPurchase(ctx: Ctx, d: z.output<typeof purchaseSchema>) {
  const { rows, total } = purchaseLines(d.lines);
  return prisma.$transaction(async (tx) => {
    const p = await tx.purchase.create({
      data: { supplierId: d.supplierId, warehouseId: d.warehouseId, expectedAt: d.expectedAt, notes: d.notes, number: await nextNumber(tx, 'CMP'), total, createdById: ctx.userId, lines: { create: rows } },
      include: purchaseInclude,
    });
    await audit(ctx, { entity: 'Purchase', entityId: p.id, action: 'create', after: p }, tx);
    return p;
  });
}

export async function updatePurchase(ctx: Ctx, id: string, d: z.output<typeof purchaseSchema>) {
  const before = await prisma.purchase.findUnique({ where: { id }, include: purchaseInclude });
  if (!before) throw notFound('Compra');
  if (before.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATUS', 'Só compras em rascunho podem ser alteradas');
  const { rows, total } = purchaseLines(d.lines);
  return prisma.$transaction(async (tx) => {
    await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });
    const p = await tx.purchase.update({
      where: { id },
      data: { supplierId: d.supplierId, warehouseId: d.warehouseId, expectedAt: d.expectedAt, notes: d.notes, total, lines: { create: rows } },
      include: purchaseInclude,
    });
    await audit(ctx, { entity: 'Purchase', entityId: id, action: 'update', before, after: p }, tx);
    return p;
  });
}

/** Recepção: entrada de stock de todas as linhas ao custo da compra (recalcula custo médio). */
export async function receivePurchase(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Purchase" WHERE id = ${id} FOR UPDATE`;
    if (!locked) throw notFound('Compra');
    if (locked.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATUS', 'Compra já recebida ou cancelada');
    const p = await tx.purchase.findUniqueOrThrow({ where: { id }, include: purchaseInclude });
    for (const l of p.lines) {
      await stockIn(tx, { itemId: l.itemId, warehouseId: p.warehouseId, quantity: l.quantity, unitCost: l.unitCost, sourceType: 'PURCHASE', sourceId: p.id, userId: ctx.userId });
    }
    const after = await tx.purchase.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date() }, include: purchaseInclude });
    await audit(ctx, { entity: 'Purchase', entityId: id, action: 'receive' }, tx);
    return after;
  });
}

// ─── Inventário ───

/** Abre contagem com o físico actual de todos os artigos activos do armazém. */
export async function openInventory(ctx: Ctx, warehouseId: string, notes?: string | null) {
  return prisma.$transaction(async (tx) => {
    const open = await tx.inventoryCount.findFirst({ where: { warehouseId, status: { in: ['OPEN', 'SUBMITTED'] } } });
    if (open) throw new AppError(409, 'INVENTORY_OPEN', `Já existe a contagem ${open.number} em curso neste armazém`);
    const items = await tx.stockItem.findMany({ where: { active: true, deletedAt: null }, include: { levels: { where: { warehouseId } } } });
    const c = await tx.inventoryCount.create({
      data: {
        number: await nextNumber(tx, 'INV'),
        warehouseId,
        notes,
        createdById: ctx.userId,
        lines: { create: items.map((i) => ({ itemId: i.id, expected: i.levels[0]?.onHand ?? 0 })) },
      },
    });
    await audit(ctx, { entity: 'InventoryCount', entityId: c.id, action: 'create' }, tx);
    return c;
  });
}

export async function saveCounts(ctx: Ctx, id: string, d: z.output<typeof inventoryCountsSchema>, submit: boolean) {
  const c = await prisma.inventoryCount.findUnique({ where: { id } });
  if (!c) throw notFound('Inventário');
  if (c.status !== 'OPEN') throw new AppError(409, 'INVALID_STATUS', 'Contagem já submetida');
  return prisma.$transaction(async (tx) => {
    for (const l of d.lines) await tx.inventoryLine.update({ where: { countId_itemId: { countId: id, itemId: l.itemId } }, data: { counted: l.counted } });
    if (submit) {
      if (await tx.inventoryLine.count({ where: { countId: id, counted: null } })) throw new AppError(400, 'INCOMPLETE', 'Há artigos por contar');
      await tx.inventoryCount.update({ where: { id }, data: { status: 'SUBMITTED' } });
    }
    await audit(ctx, { entity: 'InventoryCount', entityId: id, action: submit ? 'submit' : 'count' }, tx);
    return { ok: true };
  });
}

/**
 * Aprovação: ajusta cada artigo pela diferença contado − esperado.
 * Movimentos posteriores à abertura entram na conta (o ajuste é sobre o físico de agora).
 */
export async function approveInventory(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.inventoryCount.findUnique({ where: { id }, include: { lines: true } });
    if (!c) throw notFound('Inventário');
    if (c.status !== 'SUBMITTED') throw new AppError(409, 'INVALID_STATUS', 'Só contagens submetidas podem ser aprovadas');
    for (const l of c.lines) {
      const delta = D(l.counted!).minus(l.expected);
      if (!delta.isZero()) await adjust(tx, { itemId: l.itemId, warehouseId: c.warehouseId, delta, sourceType: 'INVENTORY', sourceId: c.id, notes: `Inventário ${c.number}`, userId: ctx.userId });
    }
    await tx.inventoryCount.update({ where: { id }, data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() } });
    await audit(ctx, { entity: 'InventoryCount', entityId: id, action: 'approve' }, tx);
    return { ok: true };
  });
}

// ─── Importação (migração): artigos + stock inicial ───

const ITEM_HEADERS: Record<string, string> = {
  codigo: 'code', code: 'code', referencia: 'code',
  nome: 'name', artigo: 'name', descricao: 'name',
  unidade: 'unit', un: 'unit',
  categoria: 'category',
  minimo: 'minStock', 'stock minimo': 'minStock',
  quantidade: 'quantity', qtd: 'quantity', stock: 'quantity', 'stock inicial': 'quantity',
  custo: 'unitCost', 'custo unitario': 'unitCost', preco: 'unitCost',
};
const CATEGORY_BY_NAME: Record<string, string> = { 'materia-prima': 'RAW_MATERIAL', 'materia prima': 'RAW_MATERIAL', obra: 'CONSTRUCTION', 'material de obra': 'CONSTRUCTION', consumivel: 'CONSUMABLE' };
const normH = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const num = (v: unknown) => (v === '' || v == null ? undefined : Number(String(v).replace(/\s/g, '').replace(',', '.')));

export async function importItems(ctx: Ctx, warehouseId: string, rows: Record<string, unknown>[], dryRun: boolean) {
  const existing = new Set((await prisma.stockItem.findMany({ select: { code: true } })).map((i) => i.code));
  const seen = new Set<string>();
  const report: { row: number; status: 'ok' | 'error' | 'duplicate'; name?: string; errors: string[] }[] = [];
  const valid: { data: z.output<typeof stockItemSchema>; quantity: number; unitCost: number }[] = [];
  for (const [i, raw] of rows.entries()) {
    const m: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) if (ITEM_HEADERS[normH(k)]) m[ITEM_HEADERS[normH(k)]] = v;
    if (m.category) m.category = CATEGORY_BY_NAME[normH(String(m.category))] ?? 'RAW_MATERIAL';
    const parsed = stockItemSchema.safeParse({ ...m, minStock: num(m.minStock) ?? 0, code: m.code == null ? undefined : String(m.code) });
    const quantity = num(m.quantity) ?? 0;
    const unitCost = num(m.unitCost) ?? 0;
    const errors = parsed.success ? [] : parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
    if (Number.isNaN(quantity) || quantity < 0) errors.push('quantidade inválida');
    if (Number.isNaN(unitCost) || unitCost < 0) errors.push('custo inválido');
    if (quantity > 0 && !unitCost) errors.push('custo unitário obrigatório quando há stock inicial');
    if (errors.length) {
      report.push({ row: i + 2, status: 'error', name: String(m.name ?? ''), errors });
      continue;
    }
    const code = parsed.data!.code;
    if (existing.has(code) || seen.has(code)) {
      report.push({ row: i + 2, status: 'duplicate', name: parsed.data!.name, errors: [existing.has(code) ? `código ${code} já existe` : `código ${code} repetido no ficheiro`] });
      continue;
    }
    seen.add(code);
    report.push({ row: i + 2, status: 'ok', name: parsed.data!.name, errors: [] });
    valid.push({ data: parsed.data!, quantity, unitCost });
  }
  let created = 0;
  if (!dryRun) {
    await prisma.$transaction(async (tx) => {
      for (const v of valid) {
        const item = await tx.stockItem.create({ data: { ...v.data, createdById: ctx.userId } });
        if (v.quantity > 0) await stockIn(tx, { itemId: item.id, warehouseId, quantity: v.quantity, unitCost: v.unitCost, sourceType: 'INVENTORY', notes: 'Stock inicial (importação)', userId: ctx.userId });
      }
      await audit(ctx, { entity: 'StockItem', action: 'import', after: { created: valid.length, warehouseId } }, tx);
    }, { timeout: 120_000 });
    created = valid.length;
  }
  const by = (s: string) => report.filter((r) => r.status === s).length;
  return { created, summary: { total: rows.length, ok: by('ok'), duplicate: by('duplicate'), error: by('error') }, rows: report };
}
