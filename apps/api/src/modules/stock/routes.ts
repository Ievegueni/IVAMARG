import { inventoryCountsSchema, listQuerySchema, manualMovementSchema, purchaseSchema, stockItemSchema, supplierSchema, warehouseSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import * as stock from './service';

type Id = { Params: { id: string } };

export async function stockRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('stock.view') };
  const create = { preHandler: app.guard('stock.create') };
  const edit = { preHandler: app.guard('stock.edit') };

  // ── Artigos ──
  app.get('/items', view, (req) =>
    stock.listItems(listQuerySchema.extend({ category: z.string().optional(), belowMin: z.coerce.boolean().optional(), warehouseId: z.string().optional() }).parse(req.query)),
  );
  app.get<Id>('/items/:id', view, async (req) => {
    const item = await prisma.stockItem.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { levels: { include: { warehouse: true } } } });
    if (!item) throw notFound('Artigo');
    return item;
  });
  app.get('/items/next-code', create, async () => ({ code: await stock.nextItemCode() }));
  app.post('/items', create, async (req) => {
    const body = stockItemSchema.extend({ code: z.string().trim().toUpperCase().optional() }).parse(req.body);
    let item;
    // Sem código → gera o próximo; se outro utilizador o apanhar ao mesmo tempo, tenta de novo.
    for (let attempt = 0; ; attempt++) {
      const code = body.code || (await stock.nextItemCode());
      try {
        item = await prisma.stockItem.create({ data: { ...body, code, createdById: req.currentUser!.id } });
        break;
      } catch (e) {
        if (body.code || attempt >= 4 || (e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    await audit(ctxOf(req), { entity: 'StockItem', entityId: item.id, action: 'create', after: item });
    return item;
  });
  app.patch<Id>('/items/:id', edit, async (req) => {
    const before = await prisma.stockItem.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!before) throw notFound('Artigo');
    const after = await prisma.stockItem.update({ where: { id: before.id }, data: stockItemSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'StockItem', entityId: before.id, action: 'update', before, after });
    return after;
  });

  app.post('/items/import', { ...create, bodyLimit: 10 * 1024 * 1024 }, (req) => {
    const b = z.object({ warehouseId: z.string(), rows: z.array(z.record(z.string(), z.unknown())).max(5000), dryRun: z.boolean() }).parse(req.body);
    return stock.importItems(ctxOf(req), b.warehouseId, b.rows, b.dryRun);
  });

  // ── Armazéns ──
  app.get('/warehouses', { preHandler: app.guard() }, () => prisma.warehouse.findMany({ orderBy: { code: 'asc' } }));
  app.post('/warehouses', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const w = await prisma.warehouse.create({ data: warehouseSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'Warehouse', entityId: w.id, action: 'create', after: w });
    return w;
  });
  app.patch<Id>('/warehouses/:id', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const before = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Armazém');
    const after = await prisma.warehouse.update({ where: { id: before.id }, data: warehouseSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'Warehouse', entityId: before.id, action: 'update', before, after });
    return after;
  });

  // ── Movimentos ──
  app.get('/movements', view, (req) =>
    stock.listMovements(
      listQuerySchema.extend({ itemId: z.string().optional(), warehouseId: z.string().optional(), type: z.string().optional(), sourceType: z.string().optional(), sourceId: z.string().optional() }).parse(req.query),
    ),
  );
  app.post('/movements', edit, (req) => stock.manualMovement(ctxOf(req), manualMovementSchema.parse(req.body)));

  // ── Fornecedores ──
  app.get('/suppliers', view, async (req) => {
    const q = listQuerySchema.parse(req.query);
    const where = { deletedAt: null, ...(q.search && { name: { contains: q.search, mode: 'insensitive' as const } }) };
    const [items, total] = await Promise.all([prisma.supplier.findMany({ where, ...pageArgs(q, ['name'], { name: 'asc' }) }), prisma.supplier.count({ where })]);
    return pageResult(items, total, q);
  });
  app.post('/suppliers', create, async (req) => {
    const s = await prisma.supplier.create({ data: { ...supplierSchema.parse(req.body), createdById: req.currentUser!.id } });
    await audit(ctxOf(req), { entity: 'Supplier', entityId: s.id, action: 'create', after: s });
    return s;
  });
  app.patch<Id>('/suppliers/:id', edit, async (req) => {
    const before = await prisma.supplier.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!before) throw notFound('Fornecedor');
    const after = await prisma.supplier.update({ where: { id: before.id }, data: supplierSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'Supplier', entityId: before.id, action: 'update', before, after });
    return after;
  });

  // ── Compras ──
  app.get('/purchases', view, async (req) => {
    const q = listQuerySchema.extend({ status: z.string().optional() }).parse(req.query);
    const where = {
      deletedAt: null,
      ...(q.status && { status: q.status as never }),
      ...(q.search && { OR: [{ number: { contains: q.search, mode: 'insensitive' as const } }, { supplier: { name: { contains: q.search, mode: 'insensitive' as const } } }] }),
    };
    const [items, total] = await Promise.all([
      prisma.purchase.findMany({ where, include: { supplier: { select: { name: true } } }, ...pageArgs(q, ['number', 'createdAt'], { createdAt: 'desc' }) }),
      prisma.purchase.count({ where }),
    ]);
    return pageResult(items, total, q);
  });
  app.get<Id>('/purchases/:id', view, async (req) => {
    const p = await prisma.purchase.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { supplier: true, lines: { include: { item: true } } } });
    if (!p) throw notFound('Compra');
    return p;
  });
  app.post('/purchases', create, (req) => stock.createPurchase(ctxOf(req), purchaseSchema.parse(req.body)));
  app.put<Id>('/purchases/:id', edit, (req) => stock.updatePurchase(ctxOf(req), req.params.id, purchaseSchema.parse(req.body)));
  app.post<Id>('/purchases/:id/receive', edit, (req) => stock.receivePurchase(ctxOf(req), req.params.id));
  app.post<Id>('/purchases/:id/cancel', edit, async (req) => {
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id } });
    if (!p) throw notFound('Compra');
    if (p.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATUS', 'Só compras em rascunho podem ser canceladas');
    await prisma.purchase.update({ where: { id: p.id }, data: { status: 'CANCELLED' } });
    await audit(ctxOf(req), { entity: 'Purchase', entityId: p.id, action: 'cancel' });
    return { ok: true };
  });

  // ── Inventário ──
  app.get('/inventories', view, async (req) => {
    const q = listQuerySchema.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.inventoryCount.findMany({ ...pageArgs(q, ['createdAt'], { createdAt: 'desc' }) }),
      prisma.inventoryCount.count(),
    ]);
    const whs = new Map((await prisma.warehouse.findMany()).map((w) => [w.id, w.name]));
    return pageResult(items.map((i) => ({ ...i, warehouseName: whs.get(i.warehouseId) })), total, q);
  });
  app.get<Id>('/inventories/:id', view, async (req) => {
    const c = await prisma.inventoryCount.findUnique({ where: { id: req.params.id }, include: { lines: { include: { item: { select: { code: true, name: true, unit: true } } }, orderBy: { item: { code: 'asc' } } } } });
    if (!c) throw notFound('Inventário');
    return c;
  });
  app.post('/inventories', create, (req) => {
    const b = z.object({ warehouseId: z.string(), notes: z.string().optional().nullable() }).parse(req.body);
    return stock.openInventory(ctxOf(req), b.warehouseId, b.notes);
  });
  app.put<Id>('/inventories/:id', edit, (req) => stock.saveCounts(ctxOf(req), req.params.id, inventoryCountsSchema.parse(req.body), false));
  app.post<Id>('/inventories/:id/submit', edit, (req) => stock.saveCounts(ctxOf(req), req.params.id, inventoryCountsSchema.parse(req.body), true));
  app.post<Id>('/inventories/:id/approve', { preHandler: app.guard('stock.approve') }, (req) => stock.approveInventory(ctxOf(req), req.params.id));
  app.post<Id>('/inventories/:id/cancel', edit, async (req) => {
    const c = await prisma.inventoryCount.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound('Inventário');
    if (c.status === 'APPROVED') throw new AppError(409, 'INVALID_STATUS', 'Inventário já aprovado');
    await prisma.inventoryCount.update({ where: { id: c.id }, data: { status: 'CANCELLED' } });
    await audit(ctxOf(req), { entity: 'InventoryCount', entityId: c.id, action: 'cancel' });
    return { ok: true };
  });
}
