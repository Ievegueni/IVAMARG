import { listQuerySchema, productModelSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { audit, ctxOf } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';

type Id = { Params: { id: string } };
const include = {
  bom: { include: { stockItem: { select: { id: true, code: true, name: true, unit: true, avgCost: true } } }, orderBy: [{ stockItemId: 'asc' as const }, { size: 'asc' as const }] },
  standardTimes: { include: { stage: { select: { id: true, name: true } } } },
};

// Catálogo / fichas técnicas. Escrita exige production.edit (ficha técnica é da produção).
export async function catalogRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.guard('production.view') }, async (req) => {
    const q = listQuerySchema.parse(req.query);
    const where = {
      deletedAt: null,
      ...(q.search && { OR: [{ reference: { contains: q.search, mode: 'insensitive' as const } }, { name: { contains: q.search, mode: 'insensitive' as const } }] }),
    };
    const [items, total] = await Promise.all([
      prisma.productModel.findMany({ where, select: { id: true, reference: true, name: true, basePrice: true, active: true, photos: true, _count: { select: { bom: true } } }, ...pageArgs(q, ['reference', 'name'], { reference: 'asc' }) }),
      prisma.productModel.count({ where }),
    ]);
    // Só a primeira foto na listagem (data URLs são pesadas).
    return pageResult(items.map((i) => ({ ...i, photos: i.photos.slice(0, 1) })), total, q);
  });

  app.get<Id>('/:id', { preHandler: app.guard('production.view') }, async (req) => {
    const m = await prisma.productModel.findFirst({ where: { id: req.params.id, deletedAt: null }, include });
    if (!m) throw notFound('Modelo');
    return m;
  });

  app.post('/', { preHandler: app.guard('production.create') }, async (req) => {
    const { bom, standardTimes, ...d } = productModelSchema.parse(req.body);
    const m = await prisma.productModel.create({ data: { ...d, createdById: req.currentUser!.id, bom: { create: bom }, standardTimes: { create: standardTimes } }, include });
    await audit(ctxOf(req), { entity: 'ProductModel', entityId: m.id, action: 'create', after: m });
    return m;
  });

  app.put<Id>('/:id', { preHandler: app.guard('production.edit') }, async (req) => {
    const before = await prisma.productModel.findFirst({ where: { id: req.params.id, deletedAt: null }, include });
    if (!before) throw notFound('Modelo');
    const { bom, standardTimes, ...d } = productModelSchema.parse(req.body);
    // A BOM é usada ao libertar a OP (necessidades gravadas nesse momento): alterar não afecta OPs já libertadas.
    const m = await prisma.$transaction(async (tx) => {
      await tx.bomLine.deleteMany({ where: { productModelId: before.id } });
      await tx.standardTime.deleteMany({ where: { productModelId: before.id } });
      return tx.productModel.update({ where: { id: before.id }, data: { ...d, bom: { create: bom }, standardTimes: { create: standardTimes } }, include });
    });
    await audit(ctxOf(req), { entity: 'ProductModel', entityId: m.id, action: 'update', before: { ...before, photos: before.photos.length }, after: { ...m, photos: m.photos.length } });
    return m;
  });
}
