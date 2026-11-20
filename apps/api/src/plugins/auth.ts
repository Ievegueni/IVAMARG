import { hasPermission, type Permission } from '@ivamarg/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { publicUser, type PublicUser } from '../modules/users/service';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: PublicUser;
  }
  interface FastifyInstance {
    /** preHandler: exige sessão válida e, opcionalmente, uma permissão. */
    guard: (permission?: Permission) => (req: FastifyRequest) => Promise<void>;
  }
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('currentUser', undefined);
  app.decorate('guard', (permission?: Permission) => async (req: FastifyRequest) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw unauthorized();
    let sub: string;
    try {
      sub = app.jwt.verify<{ sub: string }>(token).sub;
    } catch {
      throw unauthorized();
    }
    // Lido da BD a cada pedido: alterações de perfil/desactivação têm efeito imediato.
    const user = await prisma.user.findUnique({ where: { id: sub }, include: { role: true } });
    if (!user?.active) throw unauthorized();
    req.currentUser = publicUser(user);
    if (permission && !hasPermission(req.currentUser, permission)) throw forbidden();
  });
}
