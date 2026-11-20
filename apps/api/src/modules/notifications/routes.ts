import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';

export async function notificationRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.guard() };

  app.get('/', auth, async (req) => {
    const userId = req.currentUser!.id;
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  });

  app.post<{ Params: { id: string } }>('/:id/read', auth, async (req) => {
    await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.currentUser!.id }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.post('/read-all', auth, async (req) => {
    await prisma.notification.updateMany({ where: { userId: req.currentUser!.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}
