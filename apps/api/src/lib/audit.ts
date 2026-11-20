import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma';

export type Ctx = { userId?: string; ip?: string };
export const ctxOf = (req: FastifyRequest): Ctx => ({ userId: req.currentUser?.id, ip: req.ip });

const SECRET_FIELDS = new Set(['passwordHash', 'resetTokenHash', 'tokenHash']);

function snapshot(v: unknown) {
  if (v == null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (SECRET_FIELDS.has(k) ? undefined : val)));
}

export function audit(
  ctx: Ctx,
  e: { entity: string; entityId?: string; action: string; before?: unknown; after?: unknown },
  db: Prisma.TransactionClient = prisma,
) {
  return db.auditLog.create({
    data: {
      userId: ctx.userId,
      ip: ctx.ip,
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      before: snapshot(e.before),
      after: snapshot(e.after),
    },
  });
}
