import { roleSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { audit, ctxOf } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

// CRUD simples: sem lógica que justifique um service à parte.
export async function roleRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.guard('admin.view') }, () =>
    prisma.role.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } }),
  );

  app.post('/', { preHandler: app.guard('admin.create') }, async (req) => {
    const role = await prisma.role.create({ data: roleSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'Role', entityId: role.id, action: 'create', after: role });
    return role;
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: app.guard('admin.edit') }, async (req) => {
    const data = roleSchema.partial().parse(req.body);
    const before = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Perfil');
    const role = await prisma.role.update({ where: { id: before.id }, data });
    await audit(ctxOf(req), { entity: 'Role', entityId: role.id, action: 'update', before, after: role });
    return role;
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: app.guard('admin.delete') }, async (req) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } });
    if (!role) throw notFound('Perfil');
    if (role.isAdmin) throw new AppError(400, 'PROTECTED', 'O perfil Administrador não pode ser eliminado.');
    if (role._count.users) throw new AppError(409, 'IN_USE', 'Perfil com utilizadores associados. Mude-os de perfil primeiro.');
    await prisma.role.delete({ where: { id: role.id } });
    await audit(ctxOf(req), { entity: 'Role', entityId: role.id, action: 'delete', before: role });
    return { ok: true };
  });
}
