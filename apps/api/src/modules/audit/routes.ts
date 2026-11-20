import { listQuerySchema } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';

const auditQuery = listQuerySchema.extend({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.guard('admin.view') }, async (req) => {
    const q = auditQuery.parse(req.query);
    const where: Prisma.AuditLogWhereInput = {
      entity: q.entity,
      entityId: q.entityId,
      userId: q.userId,
      action: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true } } },
        ...pageArgs(q, ['createdAt', 'entity', 'action'], { createdAt: 'desc' }),
      }),
      prisma.auditLog.count({ where }),
    ]);
    return pageResult(items, total, q);
  });

  app.get('/entities', { preHandler: app.guard('admin.view') }, async () =>
    (await prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } })).map((e) => e.entity),
  );
}
