import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

export const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function setupApp() {
  const app = await buildApp();
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 1000 } });
  return app;
}

/** Cria (via BD) um utilizador com o perfil indicado e devolve um cliente HTTP autenticado. */
export async function userClient(app: FastifyInstance, roleName: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const username = `${roleName.replace(/\W/g, '').toLowerCase()}-${run}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${username}@ivamarg.ao`;
  const bcrypt = (await import('bcryptjs')).default;
  const user = await prisma.user.create({ data: { name: `${roleName} ${run}`, username, email, roleId: role.id, passwordHash: await bcrypt.hash('segredo123', 4) } });
  const token = app.jwt.sign({ sub: user.id });
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url: `/api${url}`, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
    return { status: res.statusCode, body: String(res.headers['content-type']).includes('json') ? res.json() : res.body, raw: res };
  };
  return { user, call };
}

export const line = (kind: 'UNIFORMS' | 'CONSTRUCTION' | 'BOREHOLE' | 'CLEANING') =>
  prisma.businessLine.findFirstOrThrow({ where: { kind }, include: { pipelineStages: { orderBy: { order: 'asc' } } } });
