import type { ListQuery } from '@ivamarg/shared';
import type { Prisma, Role, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { getSetting } from '../../lib/settings';

export const publicUser = (u: User & { role: Role }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  active: u.active,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  role: { id: u.role.id, name: u.role.name },
  isAdmin: u.role.isAdmin,
  // Efectivas = perfil (grupo) + concessões individuais.
  permissions: [...new Set([...u.role.permissions, ...u.extraPermissions])],
  extraPermissions: u.extraPermissions,
});
export type PublicUser = ReturnType<typeof publicUser>;

async function assertSeatAvailable() {
  const max = await getSetting('users.maxActive', 6);
  const active = await prisma.user.count({ where: { active: true } });
  if (active >= max) {
    throw new AppError(409, 'USER_LIMIT', `Limite de ${max} utilizadores activos atingido. Desactive um utilizador ou aumente o limite.`);
  }
}

export async function listUsers(q: ListQuery) {
  const where: Prisma.UserWhereInput = q.search
    ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }
    : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, include: { role: true }, ...pageArgs(q, ['name', 'email', 'createdAt', 'lastLoginAt'], { name: 'asc' }) }),
    prisma.user.count({ where }),
  ]);
  return pageResult(items.map(publicUser), total, q);
}

export async function createUser(ctx: Ctx, data: { name: string; email: string; roleId: string; password: string; phone?: string | null; extraPermissions?: string[] }) {
  await assertSeatAvailable();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        roleId: data.roleId,
        phone: data.phone,
        extraPermissions: data.extraPermissions ?? [],
        passwordHash: await bcrypt.hash(data.password, 10),
        createdById: ctx.userId,
      },
      include: { role: true },
    });
    await audit(ctx, { entity: 'User', entityId: user.id, action: 'create', after: publicUser(user) }, tx);
    return publicUser(user);
  });
}

export async function updateUser(
  ctx: Ctx,
  id: string,
  data: { name?: string; email?: string; roleId?: string; active?: boolean; password?: string; phone?: string | null; extraPermissions?: string[] },
) {
  const before = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!before) throw notFound('Utilizador');
  if (id === ctx.userId && (data.active === false || (data.roleId && data.roleId !== before.roleId))) {
    throw new AppError(400, 'SELF_LOCKOUT', 'Não pode desactivar nem mudar o perfil da sua própria conta.');
  }
  if (id === ctx.userId && data.extraPermissions && data.extraPermissions.join() !== before.extraPermissions.join()) {
    throw new AppError(403, 'SELF_GRANT', 'Não pode alterar as permissões da sua própria conta.');
  }
  if (data.active && !before.active) await assertSeatAvailable();

  const { password, ...rest } = data;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { ...rest, ...(password && { passwordHash: await bcrypt.hash(password, 10) }) },
      include: { role: true },
    });
    if (password || data.active === false) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(
      ctx,
      { entity: 'User', entityId: id, action: password ? 'update+password' : 'update', before: publicUser(before), after: publicUser(user) },
      tx,
    );
    return publicUser(user);
  });
}
