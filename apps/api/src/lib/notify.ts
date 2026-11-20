import { sendEmail } from '../jobs/outbound';
import { env } from './env';
import { prisma } from './prisma';

/** Notificação in-app + email. Chamar depois do commit da transacção. */
export async function notify(userIds: string[], n: { title: string; body?: string; link?: string }) {
  if (!userIds.length) return;
  await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, ...n })) });
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, active: true, notifyEmail: true }, select: { email: true } });
  const link = n.link ? `<p><a href="${env.APP_URL}${n.link}">Abrir na plataforma</a></p>` : '';
  await Promise.all(users.map((u) => sendEmail(u.email, n.title, `<p>${n.body ?? n.title}</p>${link}`)));
}

/** Utilizadores activos com uma permissão (administradores incluídos). */
export const usersWithPermission = async (permission: string) =>
  (
    await prisma.user.findMany({
      where: { active: true, role: { OR: [{ isAdmin: true }, { permissions: { has: permission } }] } },
      select: { id: true },
    })
  ).map((u) => u.id);
