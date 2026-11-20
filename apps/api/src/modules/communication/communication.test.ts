import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';
import { processAutomation } from './automations';
import { deliverMessage, processInbound } from './service';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let admin: Api, comercial: Api, comercial2: Api;
const phone = () => `92${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const flags = ['meta.whatsapp', 'meta.messenger', 'sms'];

const wa = (from: string, text: string, id = `wamid.${run}.${Math.random()}`, name?: string, ts = Math.floor(Date.now() / 1000)) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, timestamp: String(ts), type: 'text', text: { body: text } }] } }] }],
});

beforeAll(async () => {
  app = await setupApp();
  admin = await userClient(app, 'Administrador');
  comercial = await userClient(app, 'Comercial');
  comercial2 = await userClient(app, 'Comercial');
  await prisma.featureFlag.updateMany({ where: { key: { in: flags } }, data: { enabled: true } });
  await prisma.setting.update({ where: { key: 'comms.sandbox' }, data: { value: true } });
});
afterAll(async () => {
  await prisma.featureFlag.updateMany({ where: { key: { in: flags } }, data: { enabled: false } });
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

describe('mensagens recebidas', () => {
  it('cliente existente é encontrado pelo telefone; conversa atribuída ao comercial; timeline; sem duplicados', async () => {
    const p = phone();
    const c = (await comercial.call('POST', '/clients', { name: `Escola WA ${run}`, phones: [p] })).body;
    const payload = wa(`244${p}`, 'Bom dia, preciso de 50 fardas', `wamid.dup.${run}`);
    expect((await processInbound(payload)).stored).toBe(1);
    expect((await processInbound(payload)).stored).toBe(0); // webhook repetido
    const conv = await prisma.conversation.findFirstOrThrow({ where: { clientId: c.id }, include: { messages: true } });
    expect(conv).toMatchObject({ channel: 'WHATSAPP', assigneeId: comercial.user.id, unread: 1, status: 'OPEN' });
    expect(conv.messages).toHaveLength(1);
    expect(await prisma.timelineEvent.count({ where: { clientId: c.id, entity: 'Conversation' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: comercial.user.id, link: `/comunicacao?c=${conv.id}` } })).toBe(1);
    // aparece na ficha / caixa do comercial, não na de outro comercial
    expect((await comercial.call('GET', `/communication/conversations?clientId=${c.id}`)).body.total).toBe(1);
    expect((await comercial2.call('GET', `/communication/conversations/${conv.id}`)).status).toBe(404);
  });

  it('contacto novo cria lead (tag "lead")', async () => {
    const p = phone();
    await processInbound(wa(`244${p}`, 'Olá', undefined, 'Sr. Manuel'));
    const lead = await prisma.client.findFirstOrThrow({ where: { phones: { has: `244${p}` } } });
    expect(lead).toMatchObject({ name: 'Sr. Manuel', tags: ['lead'], ownerId: null });
  });

  it('canal desactivado: mensagens ignoradas', async () => {
    await prisma.featureFlag.update({ where: { key: 'meta.whatsapp' }, data: { enabled: false } });
    expect((await processInbound(wa(`244${phone()}`, 'x'))).stored).toBe(0);
    await prisma.featureFlag.update({ where: { key: 'meta.whatsapp' }, data: { enabled: true } });
  });
});

describe('envio e janela de 24h', () => {
  it('WhatsApp: resposta livre dentro da janela, entregue em sandbox', async () => {
    const p = phone();
    await processInbound(wa(`244${p}`, 'Preço?'));
    const conv = await prisma.conversation.findFirstOrThrow({ where: { externalId: `244${p}` } });
    const r = await admin.call('POST', `/communication/conversations/${conv.id}/messages`, { body: 'São 5.000 Kz por peça.' });
    expect(r.status).toBe(200);
    await deliverMessage(r.body.id, 0, 3);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('SIMULATED');
    expect(await prisma.integrationLog.count({ where: { system: 'meta', operation: 'send.simulated' } })).toBeGreaterThan(0);
  });

  it('WhatsApp fora da janela exige template; Messenger fora da janela é bloqueado; notas internas não são enviadas', async () => {
    const p = phone();
    await processInbound(wa(`244${p}`, 'antiga', undefined, undefined, Math.floor(Date.now() / 1000) - 25 * 3600));
    const conv = await prisma.conversation.findFirstOrThrow({ where: { externalId: `244${p}` } });
    expect((await admin.call('POST', `/communication/conversations/${conv.id}/messages`, { body: 'Olá' })).body.error.code).toBe('TEMPLATE_REQUIRED');
    const t = await prisma.messageTemplate.update({ where: { name: 'Encomenda pronta' }, data: { waTemplateName: null } });
    expect((await admin.call('POST', `/communication/conversations/${conv.id}/messages`, { templateId: t.id })).body.error.code).toBe('TEMPLATE_NOT_APPROVED');
    await prisma.messageTemplate.update({ where: { id: t.id }, data: { waTemplateName: 'encomenda_pronta' } });
    const ok = await admin.call('POST', `/communication/conversations/${conv.id}/messages`, { templateId: t.id });
    expect(ok.body).toMatchObject({ type: 'TEMPLATE', status: 'QUEUED' });
    expect(ok.body.body).toContain('está pronta');
    await prisma.messageTemplate.update({ where: { id: t.id }, data: { waTemplateName: null } });

    await processInbound({ object: 'page', entry: [{ messaging: [{ sender: { id: `psid-${run}` }, timestamp: Date.now() - 26 * 3600_000, message: { mid: `mid.${run}`, text: 'oi' } }] }] });
    const m = await prisma.conversation.findFirstOrThrow({ where: { channel: 'MESSENGER', externalId: `psid-${run}` } });
    expect((await admin.call('POST', `/communication/conversations/${m.id}/messages`, { body: 'Olá' })).body.error.code).toBe('WINDOW_CLOSED');
    const note = await admin.call('POST', `/communication/conversations/${m.id}/messages`, { body: 'Ligar amanhã', note: true });
    expect(note.body).toMatchObject({ direction: 'NOTE', status: 'NOTE' });
  });

  it('simulador sandbox usa o mesmo processamento do webhook', async () => {
    const r = await admin.call('POST', '/communication/simulate-inbound', { channel: 'WHATSAPP', from: `+244 ${phone()}`, name: 'Simulado', text: 'Teste' });
    expect(r.body.stored).toBe(1);
    expect((await comercial.call('POST', '/communication/simulate-inbound', { channel: 'WHATSAPP', from: '923000000', text: 'x' })).status).toBe(403);
  });
});

describe('automações', () => {
  it('encomenda pronta → mensagem WhatsApp ao cliente (template com variáveis)', async () => {
    const p = phone();
    const client = (await admin.call('POST', '/clients', { name: `Cliente auto ${run}`, phones: [p] })).body;
    const order = (await admin.call('POST', '/orders', { clientId: client.id, lines: [{ description: 'Bata', quantity: 2, unitPrice: 1000 }] })).body;
    const t = await prisma.messageTemplate.findFirstOrThrow({ where: { name: 'Encomenda pronta' } });
    await prisma.automation.create({ data: { name: `Auto ${run}`, trigger: 'ORDER_READY', channel: 'WHATSAPP', templateId: t.id, recipient: 'CLIENT' } });
    const res = await processAutomation({ name: 'ORDER_READY', data: { orderId: order.id } } as never);
    expect(res.sent).toBeGreaterThan(0);
    const msg = await prisma.message.findFirstOrThrow({ where: { conversation: { clientId: client.id } } });
    expect(msg.body).toBe(`Olá ${client.name}, a sua encomenda ${order.number} está pronta para entrega. Ivamarg, Lda`);
    expect(msg.templateVars).toMatchObject({ encomenda: order.number, cliente: client.name });
    await prisma.automation.updateMany({ where: { name: `Auto ${run}` }, data: { active: false } });
  });
});
