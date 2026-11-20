import { listQuerySchema, userCreateSchema, userUpdateSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import * as users from './service';

export async function userRoutes(app: FastifyInstance) {
  // Lista mínima para selectores (comercial responsável, etc.).
  app.get('/options', { preHandler: app.guard() }, () =>
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  );
  app.get('/', { preHandler: app.guard('admin.view') }, (req) => users.listUsers(listQuerySchema.parse(req.query)));
  app.post('/', { preHandler: app.guard('admin.create') }, (req) =>
    users.createUser(ctxOf(req), userCreateSchema.parse(req.body)),
  );
  // Preferências do próprio utilizador.
  app.patch('/me/preferences', { preHandler: app.guard() }, async (req) => {
    const { notifyEmail } = z.object({ notifyEmail: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.currentUser!.id }, data: { notifyEmail } });
    return { notifyEmail };
  });
  app.get('/me/preferences', { preHandler: app.guard() }, async (req) =>
    prisma.user.findUniqueOrThrow({ where: { id: req.currentUser!.id }, select: { notifyEmail: true } }),
  );
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: app.guard('admin.edit') }, (req) =>
    users.updateUser(ctxOf(req), req.params.id, userUpdateSchema.parse(req.body)),
  );
}
