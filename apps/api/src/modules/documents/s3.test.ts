import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { documentsExpiryAlert, taskReminders } from '../../jobs/alerts';
import { closeQueues } from '../../jobs/queues';
import { env } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { processVendus } from '../invoices/service';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let admin: Api, gestor: Api, comercial: Api, prod: Api;

beforeAll(async () => {
  app = await setupApp();
  admin = await userClient(app, 'Administrador');
  gestor = await userClient(app, 'Gestor');
  comercial = await userClient(app, 'Comercial');
  prod = await userClient(app, 'Produção/Stock');
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

/** Pedido multipart (ficheiro + campo meta) como o browser faz. */
function multipart(api: Api, url: string, file: { name: string; type: string; content: Buffer }, meta?: object) {
  const b = `----ivamarg${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  if (meta) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.content, Buffer.from(`\r\n--${b}--\r\n`));
  const token = app.jwt.sign({ sub: api.user.id });
  return app.inject({ method: 'POST', url: `/api${url}`, headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${b}` }, payload: Buffer.concat(parts) });
}
const pdf = (s = 'teste') => ({ name: 'alvara.pdf', type: 'application/pdf', content: Buffer.from(`%PDF-1.4 ${s}`) });

describe('documentos', () => {
  let cat: { id: string }, rh: { id: string }, clientId: string, docId: string;
  beforeAll(async () => {
    cat = await prisma.documentCategory.findFirstOrThrow({ where: { name: 'Alvarás e licenças' } });
    rh = await prisma.documentCategory.findFirstOrThrow({ where: { name: 'RH' } });
    clientId = (await comercial.call('POST', '/clients', { name: `Cliente docs ${run}` })).body.id;
  });

  it('upload com metadados e ligação ao cliente → aparece na timeline e na pesquisa', async () => {
    const r = await multipart(comercial, '/documents', pdf(), { title: `Alvará ${run}`, categoryId: cat.id, tags: ['Licenca'], expiresAt: '2030-01-01', links: [{ entity: 'Client', entityId: clientId }] });
    expect(r.statusCode).toBe(200);
    docId = r.json().id;
    expect(r.json().tags).toEqual(['licenca']);
    expect(await prisma.timelineEvent.count({ where: { clientId, entity: 'Document', entityId: docId } })).toBe(1);
    const list = await comercial.call('GET', `/documents?entity=Client&entityId=${clientId}`);
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([docId]);
    expect(await prisma.auditLog.count({ where: { entity: 'Document', entityId: docId, action: 'upload' } })).toBe(1);
  });

  it('rejeita tipo não permitido e ficheiro sem categoria permitida', async () => {
    const exe = await multipart(comercial, '/documents', { name: 'x.html', type: 'text/html', content: Buffer.from('<script>') }, { title: 'X', categoryId: cat.id });
    expect(exe.json().error.code).toBe('INVALID_FILE_TYPE');
    const r = await multipart(comercial, '/documents', pdf(), { title: 'Contrato de trabalho', categoryId: rh.id });
    expect(r.json().error.code).toBe('INVALID_CATEGORY');
  });

  it('categoria RH só para Administrador/Gestor', async () => {
    const r = await multipart(gestor, '/documents', pdf(), { title: `Contrato RH ${run}`, categoryId: rh.id });
    expect(r.statusCode).toBe(200);
    expect((await comercial.call('GET', `/documents/${r.json().id}`)).status).toBe(403);
    expect((await comercial.call('GET', `/documents?search=${encodeURIComponent(`Contrato RH ${run}`)}`)).body.total).toBe(0);
    expect((await gestor.call('GET', `/documents/${r.json().id}`)).status).toBe(200);
  });

  it('nova versão mantém as anteriores; link assinado serve o ficheiro certo e fica auditado', async () => {
    const v2 = await multipart(comercial, `/documents/${docId}/versions`, pdf('v2'));
    expect(v2.json().currentVersion).toBe(2);
    expect(v2.json().versions).toHaveLength(2);
    const u1 = (await comercial.call('GET', `/documents/${docId}/url?version=1&download=1`)).body.url;
    const f1 = await app.inject({ url: u1 });
    expect(f1.body).toBe('%PDF-1.4 teste');
    expect(f1.headers['content-disposition']).toContain('alvara.pdf');
    expect(f1.headers['x-content-type-options']).toBe('nosniff');
    const u2 = (await comercial.call('GET', `/documents/${docId}/url`)).body.url;
    expect((await app.inject({ url: u2 })).body).toBe('%PDF-1.4 v2');
    const tampered = u2.replace(/sig=(\w)/, (_m: string, c: string) => `sig=${c === '0' ? '1' : '0'}`); // carácter sempre diferente
    expect((await app.inject({ url: tampered })).statusCode).toBe(403);
    expect(await prisma.auditLog.count({ where: { entity: 'Document', entityId: docId, action: 'download' } })).toBe(1);
  });

  it('alertas de validade: limiares 30/15/7 e expirado, sem repetir', async () => {
    const now = new Date('2030-01-01T08:00:00Z');
    const d = await multipart(gestor, '/documents', pdf(), { title: `Certidão ${run}`, categoryId: cat.id, expiresAt: '2030-01-13' });
    const id = d.json().id;
    const alerts = () => prisma.notification.count({ where: { userId: gestor.user.id, link: `/documents?id=${id}`.replace('/documents', '/documentos') } });
    await documentsExpiryAlert(now); // faltam 12 dias → limiar 15
    expect(await alerts()).toBe(1);
    await documentsExpiryAlert(now); // mesmo dia: não repete
    expect(await alerts()).toBe(1);
    await documentsExpiryAlert(new Date('2030-01-06T08:00:00Z')); // faltam 7
    expect(await alerts()).toBe(2);
    await documentsExpiryAlert(new Date('2030-01-14T08:00:00Z')); // expirado
    expect(await alerts()).toBe(3);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).lastAlertDays).toBe(0);
  });
});

describe('tarefas e agenda', () => {
  it('comercial vê só as suas; atribuição notifica; lembrete de atraso uma vez por dia', async () => {
    const t = await gestor.call('POST', '/tasks', { title: `Ligar ao cliente ${run}`, assigneeId: comercial.user.id, dueAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(t.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: comercial.user.id, title: { contains: `Ligar ao cliente ${run}` } } })).toBe(1);
    const other = await gestor.call('POST', '/tasks', { title: `Interna ${run}`, assigneeId: gestor.user.id });
    const mine = await comercial.call('GET', '/tasks?pageSize=100');
    expect(mine.body.items.some((x: { id: string }) => x.id === t.body.id)).toBe(true);
    expect(mine.body.items.some((x: { id: string }) => x.id === other.body.id)).toBe(false);
    expect((await comercial.call('PATCH', `/tasks/${other.body.id}`, { status: 'DONE' })).status).toBe(404);

    await taskReminders();
    await taskReminders();
    expect(await prisma.notification.count({ where: { userId: comercial.user.id, title: `Tarefa em atraso: Ligar ao cliente ${run}` } })).toBe(1);
    const done = await comercial.call('PATCH', `/tasks/${t.body.id}`, { status: 'DONE' });
    expect(done.body.completedAt).not.toBeNull();
  });

  it('evento: fim antes do início é recusado; convidados notificados', async () => {
    const bad = await comercial.call('POST', '/tasks/events', { title: 'Visita', startAt: '2030-01-02T10:00:00Z', endAt: '2030-01-02T09:00:00Z' });
    expect(bad.status).toBe(400);
    const ev = await comercial.call('POST', '/tasks/events', { title: `Visita obra ${run}`, type: 'VISIT', startAt: '2030-01-02T10:00:00Z', endAt: '2030-01-02T11:00:00Z', attendeeIds: [gestor.user.id] });
    expect(ev.body.attendeeIds).toEqual(expect.arrayContaining([comercial.user.id, gestor.user.id]));
    const cal = await gestor.call('GET', '/tasks/events?from=2030-01-01T00:00:00Z&to=2030-01-03T00:00:00Z');
    expect(cal.body.some((e: { id: string }) => e.id === ev.body.id)).toBe(true);
  });
});

describe('facturação Vendus (API simulada)', () => {
  let orderId: string;
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];

  beforeAll(async () => {
    const client = (await admin.call('POST', '/clients', { name: `Cliente factura ${run}`, nif: String(Math.floor(Math.random() * 1e9)).padStart(9, '5') })).body;
    const o = (await admin.call('POST', '/orders', { clientId: client.id, lines: [{ description: 'Bata', quantity: 10, unitPrice: 3000 }] })).body;
    orderId = o.id;
  });

  const stubVendus = (fail = 0) => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init.method ?? 'GET', url: String(url), body });
      if (String(url).endsWith('/documents') && n++ < fail) return new Response('erro temporário', { status: 503 });
      if (String(url).endsWith('/clients')) return Response.json({ id: 901 });
      if (String(url).endsWith('/documents')) return Response.json({ id: 77, number: 'FT T/12' });
      return Response.json({});
    }));
  };
  const job = (invoiceId: string, attemptsMade = 0) => ({ name: 'issue-invoice', data: { invoiceId }, attemptsMade, opts: { attempts: 3 } }) as never;

  it('só factura encomendas prontas; sem API key falha logo (sem retries) e notifica', async () => {
    expect((await admin.call('POST', '/invoices', { source: 'Order', sourceId: orderId })).body.error.code).toBe('NOT_READY');
    await admin.call('PATCH', `/orders/${orderId}`, { status: 'READY' });
    expect((await comercial.call('POST', '/invoices', { source: 'Order', sourceId: orderId })).status).toBe(403);
    const inv = (await admin.call('POST', '/invoices', { source: 'Order', sourceId: orderId })).body;
    expect(inv.status).toBe('PENDING');
    expect(inv.total).toBe(30000);
    const saved = env.VENDUS_API_KEY;
    env.VENDUS_API_KEY = undefined;
    await expect(processVendus(job(inv.id))).rejects.toThrow('VENDUS_API_KEY');
    env.VENDUS_API_KEY = saved;
    const failed = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(failed.status).toBe('FAILED');
    expect(await prisma.notification.count({ where: { userId: admin.user.id, title: 'Falha na emissão de factura' } })).toBeGreaterThan(0);
  });

  it('retry: erro temporário mantém PENDING; sucesso emite, guarda nº/ID, cria cliente no Vendus e regista logs', async () => {
    env.VENDUS_API_KEY = 'chave-teste';
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId } });
    expect((await admin.call('POST', `/invoices/${inv.id}/retry`)).status).toBe(200);
    expect((await admin.call('POST', '/invoices', { source: 'Order', sourceId: orderId })).body.error.code).toBe('ALREADY_INVOICED');

    stubVendus(1);
    await expect(processVendus(job(inv.id, 0))).rejects.toThrow('Vendus 503');
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('PENDING');
    await processVendus(job(inv.id, 1));
    const ok = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(ok).toMatchObject({ status: 'ISSUED', number: 'FT T/12', vendusDocumentId: '77' });

    const doc = calls.filter((c) => c.url.endsWith('/documents')).at(-1)!;
    expect(doc.body).toMatchObject({ type: 'FT', mode: 'tests', client: { id: '901' }, items: [{ title: 'Bata', qty: 10, gross_price: 3000 }] });
    expect(await prisma.externalRef.count({ where: { entity: 'Client', entityId: inv.clientId, system: 'vendus', externalId: '901' } })).toBe(1);
    expect(await prisma.integrationLog.count({ where: { system: 'vendus', status: 'error' } })).toBeGreaterThan(0);
    expect(await prisma.timelineEvent.count({ where: { clientId: inv.clientId, entity: 'Invoice' } })).toBe(1);
  });
});

describe('dashboards', () => {
  it('direcção só com relatórios "ver todos"; comercial e produção', async () => {
    expect((await comercial.call('GET', '/dashboard/direction')).status).toBe(403);
    const d = await gestor.call('GET', '/dashboard/direction');
    expect(d.status).toBe(200);
    expect(Object.keys(d.body)).toEqual(['production', 'quality', 'stock', 'commercial', 'documents', 'margins', 'ranking']);
    expect((await comercial.call('GET', '/dashboard/commercial')).body).toHaveProperty('pipelineValue');
    expect((await prod.call('GET', '/dashboard/production')).body).toHaveProperty('stages');
  });
});
