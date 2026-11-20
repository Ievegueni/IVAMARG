import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, userClient } from '../test/helpers';
import { prisma } from './lib/prisma';
import { buildApp } from './app';
import { closeQueues } from './jobs/queues';

// Rotas públicas por desenho. Tudo o resto tem de ter preHandler de autenticação/permissão.
const PUBLIC = new Set([
  'GET /api/health',
  'POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/auth/logout', 'POST /api/auth/forgot-password', 'POST /api/auth/reset-password',
  'GET /api/webhooks/meta', 'POST /api/webhooks/meta', // assinatura Meta
  'GET /api/files', // URL assinado (HMAC + expiração)
  // Chão de fábrica: token de operador validado dentro de cada rota (operatorOf)
  'POST /api/floor/login', 'GET /api/floor/lots/:code', 'POST /api/floor/start', 'POST /api/floor/logs/:id/finish', 'GET /api/floor/my-open', 'GET /api/floor/defect-types',
]);

describe('controlo de acesso', () => {
  it('todas as rotas privadas têm guarda de acesso', async () => {
    const routes: { route: string; guarded: boolean }[] = [];
    const app = await buildApp({ onRoute: (r) => routes.push(r) });
    await app.close();
    await closeQueues();
    const unguarded = routes.filter((r) => !r.guarded && !PUBLIC.has(r.route) && !r.route.startsWith('HEAD '));
    expect(unguarded.map((r) => r.route)).toEqual([]);
    expect(routes.length).toBeGreaterThan(150);
  });
});

describe('permissões por utilizador (além do perfil)', () => {
  let app: Awaited<ReturnType<typeof setupApp>>;
  beforeAll(async () => { app = await setupApp(); });
  afterAll(async () => {
    await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
    await app.close();
    await closeQueues();
  });

  it('concessão individual dá acesso só a esse utilizador; ninguém altera as próprias permissões', async () => {
    const admin = await userClient(app, 'Administrador');
    const com = await userClient(app, 'Comercial');
    const other = await userClient(app, 'Comercial');
    expect((await com.call('GET', '/finance/entries')).status).toBe(403);
    const r = await admin.call('PATCH', `/users/${com.user.id}`, { extraPermissions: ['finance.view', 'finance.viewAll'] });
    expect(r.status).toBe(200);
    expect(r.body.permissions).toContain('finance.viewAll');
    expect((await com.call('GET', '/finance/entries')).status).toBe(200);
    expect((await other.call('GET', '/finance/entries')).status).toBe(403); // o perfil não mudou
    expect((await admin.call('PATCH', `/users/${admin.user.id}`, { extraPermissions: ['admin.edit'] })).body.error.code).toBe('SELF_GRANT');
    expect((await admin.call('PATCH', `/users/${com.user.id}`, { extraPermissions: ['inventado.ver'] })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { entity: 'User', entityId: com.user.id, action: 'update' } })).toBeGreaterThan(0);
  });

  it('não liga documentos a clientes fora da carteira', async () => {
    const owner = await userClient(app, 'Comercial');
    const intruder = await userClient(app, 'Comercial');
    const client = (await owner.call('POST', '/clients', { name: `Carteira ${Date.now()}` })).body;
    const cat = await prisma.documentCategory.findFirstOrThrow({ where: { name: 'Contratos' } });
    const b = `----x${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify({ title: 'Intruso', categoryId: cat.id, links: [{ entity: 'Client', entityId: client.id }] })}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--${b}--\r\n`),
    ]);
    const r = await app.inject({ method: 'POST', url: '/api/documents', headers: { authorization: `Bearer ${app.jwt.sign({ sub: intruder.user.id })}`, 'content-type': `multipart/form-data; boundary=${b}` }, payload: body });
    expect(r.statusCode).toBe(403);
  });
});
