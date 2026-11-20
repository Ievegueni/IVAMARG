import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { sendEmail } from '../../jobs/outbound';
import { audit, type Ctx } from '../../lib/audit';
import { randomToken, sha256 } from '../../lib/crypto';
import { env } from '../../lib/env';
import { AppError, unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { publicUser } from '../users/service';

export const ACCESS_TTL = '15m';
export const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 60;
const ROTATION_GRACE_MS = 60_000;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email ou palavra-passe incorrectos');

export async function login(app: FastifyInstance, ctx: Ctx & { userAgent?: string }, email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalidCredentials();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const min = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(423, 'ACCOUNT_LOCKED', `Conta bloqueada por tentativas falhadas. Tente novamente em ${min} min.`);
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await audit({ ...ctx, userId: user.id }, { entity: 'User', entityId: user.id, action: lock ? 'locked' : 'login_failed' });
    throw invalidCredentials();
  }
  if (!user.active) throw new AppError(403, 'USER_INACTIVE', 'Utilizador desactivado. Contacte o administrador.');

  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const refreshToken = randomToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
  await audit({ ...ctx, userId: user.id }, { entity: 'User', entityId: user.id, action: 'login' });
  return { accessToken: app.jwt.sign({ sub: user.id }, { expiresIn: ACCESS_TTL }), refreshToken, user: publicUser(user) };
}

/** Roda o refresh token: o antigo deixa de ser válido. */
export async function refresh(app: FastifyInstance, token: string | undefined) {
  if (!token) throw unauthorized();
  const hash = sha256(token);
  const include = { user: { include: { role: true } } };
  const session =
    (await prisma.session.findUnique({ where: { tokenHash: hash }, include })) ??
    (await prisma.session.findFirst({ where: { prevTokenHash: hash, rotatedAt: { gt: new Date(Date.now() - ROTATION_GRACE_MS) } }, include }));
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) throw unauthorized();
  const refreshToken = randomToken();
  await prisma.session.update({ where: { id: session.id }, data: { tokenHash: sha256(refreshToken), prevTokenHash: session.tokenHash, rotatedAt: new Date() } });
  return {
    accessToken: app.jwt.sign({ sub: session.userId }, { expiresIn: ACCESS_TTL }),
    refreshToken,
    user: publicUser(session.user),
  };
}

export async function logout(ctx: Ctx, token: string | undefined) {
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.revokedAt) return;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await audit({ ...ctx, userId: session.userId }, { entity: 'User', entityId: session.userId, action: 'logout' });
}

/** Responde sempre igual, exista ou não o email (não revela contas). */
export async function forgotPassword(ctx: Ctx, email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.active) return;
  const token = randomToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { resetTokenHash: sha256(token), resetTokenExpiry: new Date(Date.now() + RESET_MINUTES * 60000) },
  });
  const link = `${env.APP_URL}/redefinir-palavra-passe?token=${token}`;
  await sendEmail(
    user.email,
    'Recuperação de palavra-passe - Ivamarg',
    `<p>Olá ${user.name},</p><p>Para definir uma nova palavra-passe, abra este link (válido durante ${RESET_MINUTES} minutos):</p><p><a href="${link}">${link}</a></p><p>Se não pediu esta alteração, ignore este email.</p>`,
  );
  await audit({ ...ctx, userId: user.id }, { entity: 'User', entityId: user.id, action: 'password_reset_requested' });
}

export async function resetPassword(ctx: Ctx, token: string, password: string) {
  const user = await prisma.user.findUnique({ where: { resetTokenHash: sha256(token) } });
  if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
    throw new AppError(400, 'INVALID_TOKEN', 'Link inválido ou expirado. Peça um novo.');
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        resetTokenHash: null,
        resetTokenExpiry: null,
        failedLogins: 0,
        lockedUntil: null,
      },
    }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ ...ctx, userId: user.id }, { entity: 'User', entityId: user.id, action: 'password_reset' });
}
