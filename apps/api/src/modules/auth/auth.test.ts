import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeQueues } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';

let app: FastifyInstance;
// BD de teste não é limpa entre execuções: emails únicos por execução.
const run = Date.now().toString(36);
const ANA = `ana-${run}`; // nome de utilizador (email = ANA@ivamarg.ao)
const GESTOR = `gestor-${run}`;
const ADMIN = { username: process.env.SEED_ADMIN_USERNAME ?? 'admin', email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };

const login = (username: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === 'ivamarg_rt')!.value;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp();
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 1000 } });
});
afterAll(async () => {
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

describe('autenticação', () => {
  it('rejeita credenciais erradas e audita', async () => {
    const res = await login(ADMIN.username, 'errada');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.auditLog.count({ where: { action: 'login_failed' } })).toBeGreaterThan(0);
  });

  it('login → me → refresh roda o token → logout revoga', async () => {
    const res = await login(ADMIN.username, ADMIN.password);
    expect(res.statusCode).toBe(200);
    const { accessToken, user } = res.json();
    expect(user.isAdmin).toBe(true);
    expect(user.passwordHash).toBeUndefined();

    const me = await app.inject({ url: '/api/auth/me', headers: as(accessToken) });
    expect(me.json().email).toBe(ADMIN.email);

    const rt1 = cookieOf(res);
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ivamarg_rt: rt1 } });
    expect(r1.statusCode).toBe(200);
    const rt2 = cookieOf(r1);
    expect(rt2).not.toBe(rt1);
    // token antigo ainda serve durante a tolerância (resposta perdida), depois deixa de servir
    const again = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ivamarg_rt: rt1 } });
    expect(again.statusCode).toBe(200);
    await prisma.session.updateMany({ where: { rotatedAt: { not: null } }, data: { rotatedAt: new Date(Date.now() - 120_000) } });
    const r2 = cookieOf(again);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ivamarg_rt: rt2 } })).statusCode).toBe(401);

    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { ivamarg_rt: r2 } });
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ivamarg_rt: r2 } })).statusCode).toBe(401);
  });

  it('pedido sem token → 401 no formato padrão', async () => {
    const res = await app.inject({ url: '/api/users' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });
});

describe('utilizadores e permissões', () => {
  let adminToken: string;
  beforeAll(async () => {
    adminToken = (await login(ADMIN.username, ADMIN.password)).json().accessToken;
  });

  it('comercial só vê o que o perfil permite; criação fica auditada', async () => {
    const roles = (await app.inject({ url: '/api/roles', headers: as(adminToken) })).json();
    const comercial = roles.find((r: { name: string }) => r.name === 'Comercial');
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: as(adminToken),
      payload: { name: 'Ana Comercial', username: ANA, email: `${ANA}@ivamarg.ao`, roleId: comercial.id, password: 'segredo123' },
    });
    expect(created.statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { entity: 'User', entityId: created.json().id, action: 'create' } })).toBe(1);

    const token = (await login(ANA, 'segredo123')).json().accessToken;
    expect((await app.inject({ url: '/api/users', headers: as(token) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/backoffice/settings', headers: as(token) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/backoffice/business-lines', headers: as(token) })).statusCode).toBe(200);
  });

  it('desactivar utilizador invalida o acesso imediatamente', async () => {
    const ana = await prisma.user.findUniqueOrThrow({ where: { username: ANA } });
    const token = (await login(ANA, 'segredo123')).json().accessToken;
    await app.inject({ method: 'PATCH', url: `/api/users/${ana.id}`, headers: as(adminToken), payload: { active: false } });
    expect((await app.inject({ url: '/api/auth/me', headers: as(token) })).statusCode).toBe(401);
  });

  it('respeita o limite de utilizadores activos', async () => {
    const active = await prisma.user.count({ where: { active: true } });
    await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: active } });
    const role = await prisma.role.findFirstOrThrow();
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: as(adminToken),
      payload: { name: 'Excedente', username: `x-${run}`, email: `x-${run}@ivamarg.ao`, roleId: role.id, password: 'segredo123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USER_LIMIT');
    // reactivar também conta para o limite
    const ana = await prisma.user.findUniqueOrThrow({ where: { username: ANA } });
    const re = await app.inject({ method: 'PATCH', url: `/api/users/${ana.id}`, headers: as(adminToken), payload: { active: true } });
    expect(re.json().error.code).toBe('USER_LIMIT');
    await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 1000 } });
  });

  it('bloqueia a conta após 5 tentativas falhadas', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'Gestor' } });
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: as(adminToken),
      payload: { name: 'Gestor', username: GESTOR, email: `${GESTOR}@ivamarg.ao`, roleId: role.id, password: 'segredo123' },
    });
    // instância nova: contador do rate limit a zero
    const fresh = await buildApp();
    const tryLogin = (password: string) =>
      fresh.inject({ method: 'POST', url: '/api/auth/login', payload: { username: GESTOR, password } });
    for (let i = 0; i < 5; i++) await tryLogin('errada');
    const res = await tryLogin('segredo123');
    expect(res.statusCode).toBe(423);
    expect(res.json().error.code).toBe('ACCOUNT_LOCKED');

    // rate limit: 10 pedidos/minuto ao login
    for (let i = 0; i < 4; i++) await tryLogin('errada');
    const limited = await tryLogin('errada');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    await fresh.close();
  });
});

describe('webhook Meta', () => {
  it('responde ao desafio de verificação', async () => {
    const ok = await app.inject({
      url: `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${process.env.META_VERIFY_TOKEN}&hub.challenge=123`,
    });
    expect(ok.body).toBe('123');
    expect((await app.inject({ url: '/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1' })).statusCode).toBe(403);
  });
});
