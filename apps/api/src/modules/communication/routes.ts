import { automationSchema, conversationUpdateSchema, listQuerySchema, newConversationSchema, normalizePhone, sendMessageSchema, simulateInboundSchema, templateSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { env } from '../../lib/env';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { isEnabled } from '../../lib/settings';
import { getClient } from '../clients/service';
import * as calls from './calls';
import * as comms from './service';

type Id = { Params: { id: string } };

export async function communicationRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('communication.view') };
  const create = { preHandler: app.guard('communication.create') };
  const cfg = { preHandler: app.guard('backoffice.edit') };

  app.get('/conversations', view, (req) =>
    comms.listConversations(req.currentUser!, listQuerySchema.extend({ channel: z.string().optional(), status: z.string().optional(), assigneeId: z.string().optional(), clientId: z.string().optional() }).parse(req.query)),
  );
  app.get<Id>('/conversations/:id', view, (req) => comms.getConversation(req.currentUser!, req.params.id));
  app.patch<Id>('/conversations/:id', { preHandler: app.guard('communication.edit') }, async (req) => {
    const before = await comms.getConversation(req.currentUser!, req.params.id);
    const d = conversationUpdateSchema.parse(req.body);
    if (d.clientId) await getClient(req.currentUser!, d.clientId);
    const after = await prisma.conversation.update({ where: { id: before.id }, data: d });
    await audit(ctxOf(req), { entity: 'Conversation', entityId: before.id, action: 'update', before: { status: before.status, assigneeId: before.assigneeId, clientId: before.clientId }, after: d });
    return after;
  });
  app.post<Id>('/conversations/:id/messages', create, (req) => comms.sendMessage(ctxOf(req), req.currentUser!, req.params.id, sendMessageSchema.parse(req.body)));

  /** Nova conversa iniciada por nós (email, SMS ou WhatsApp com template) a partir da ficha do cliente. */
  app.post('/conversations', create, async (req) => {
    const d = newConversationSchema.parse(req.body);
    if (d.channel === 'MESSENGER' || d.channel === 'INSTAGRAM') throw new AppError(400, 'CANNOT_START', 'Messenger/Instagram: só é possível responder a mensagens recebidas');
    const client = await getClient(req.currentUser!, d.clientId);
    const externalId = d.channel === 'EMAIL' ? d.to.toLowerCase() : normalizePhone(d.to);
    return prisma.conversation.upsert({
      where: { channel_externalId: { channel: d.channel, externalId } },
      create: { channel: d.channel, externalId, contactName: client.name, clientId: client.id, assigneeId: req.currentUser!.id },
      update: { clientId: client.id },
    });
  });

  /** Media recebida (WhatsApp): pedida à Meta com o token, a pedido. */
  app.get<Id>('/messages/:id/media', view, async (req, reply) => {
    const m = await prisma.message.findUnique({ where: { id: req.params.id }, include: { conversation: true } });
    if (!m?.mediaId) throw notFound('Media');
    await comms.getConversation(req.currentUser!, m.conversationId); // valida acesso
    if (m.conversation.channel !== 'WHATSAPP') return reply.redirect(m.mediaId); // Messenger/IG: URL directo
    if (!env.WA_ACCESS_TOKEN) throw new AppError(503, 'NOT_CONFIGURED', 'WhatsApp não configurado');
    const auth = { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}` };
    const meta = await (await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${m.mediaId}`, { headers: auth })).json();
    const file = await fetch(meta.url, { headers: auth });
    if (!file.ok) throw new AppError(502, 'META_ERROR', 'Não foi possível obter o ficheiro');
    return reply.type(meta.mime_type ?? 'application/octet-stream').header('X-Content-Type-Options', 'nosniff').send(Buffer.from(await file.arrayBuffer()));
  });

  // ── Chamadas WhatsApp (flag whatsapp.calls) ──
  app.get('/calls/active', view, (req) => calls.activeCalls(req.currentUser!));
  app.get<Id>('/calls/:id', view, async (req) => {
    const c = await prisma.callLog.findFirst({ where: { id: req.params.id, conversation: await comms.conversationScope(req.currentUser!) } });
    if (!c) throw notFound('Chamada');
    return c;
  });
  app.post<Id>('/calls/:id/accept', create, (req) => calls.acceptCall(ctxOf(req), req.currentUser!, req.params.id, z.object({ sdp: z.string().default('') }).parse(req.body ?? {}).sdp));
  app.post<Id>('/calls/:id/reject', create, (req) => calls.rejectCall(ctxOf(req), req.currentUser!, req.params.id));
  app.post<Id>('/calls/:id/end', create, (req) => calls.endCall(ctxOf(req), req.currentUser!, req.params.id, z.object({ result: z.string().optional().nullable() }).parse(req.body ?? {}).result));
  app.post<Id>('/conversations/:id/call', create, (req) => calls.startCall(ctxOf(req), req.currentUser!, req.params.id, z.object({ sdp: z.string().default('') }).parse(req.body ?? {}).sdp));
  app.post<Id>('/conversations/:id/call-consent', { preHandler: app.guard('communication.edit') }, (req) => calls.setConsent(ctxOf(req), req.currentUser!, req.params.id, z.object({ granted: z.boolean() }).parse(req.body).granted));
  app.post('/calls/simulate-incoming', { preHandler: app.guard('backoffice.edit') }, (req) => calls.simulateIncoming(z.object({ from: z.string().min(6) }).parse(req.body).from));

  // ── Templates e automações (backoffice) ──
  app.get('/templates', view, () => prisma.messageTemplate.findMany({ orderBy: { name: 'asc' } }));
  app.post('/templates', cfg, async (req) => {
    const t = await prisma.messageTemplate.create({ data: templateSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'MessageTemplate', entityId: t.id, action: 'create', after: t });
    return t;
  });
  app.patch<Id>('/templates/:id', cfg, async (req) => {
    const before = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Template');
    const after = await prisma.messageTemplate.update({ where: { id: before.id }, data: templateSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'MessageTemplate', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.get('/automations', { preHandler: app.guard('backoffice.view') }, () => prisma.automation.findMany({ include: { template: { select: { name: true } } }, orderBy: { name: 'asc' } }));
  app.post('/automations', cfg, async (req) => {
    const a = await prisma.automation.create({ data: automationSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'Automation', entityId: a.id, action: 'create', after: a });
    return a;
  });
  app.patch<Id>('/automations/:id', cfg, async (req) => {
    const before = await prisma.automation.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Automação');
    const after = await prisma.automation.update({ where: { id: before.id }, data: automationSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'Automation', entityId: before.id, action: 'update', before, after });
    return after;
  });

  /**
   * Sandbox: simula uma mensagem recebida construindo o mesmo payload do webhook Meta e
   * processando-o pelo mesmo código (match de cliente, lead, conversa, timeline, notificação).
   */
  app.post('/simulate-inbound', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    if (!(await comms.sandbox())) throw new AppError(409, 'NOT_SANDBOX', 'Disponível apenas em modo sandbox');
    const d = simulateInboundSchema.parse(req.body);
    const flag = { WHATSAPP: 'meta.whatsapp', MESSENGER: 'meta.messenger', INSTAGRAM: 'meta.instagram' }[d.channel];
    if (!(await isEnabled(flag))) throw new AppError(409, 'CHANNEL_DISABLED', 'Active o canal em Configurações → Funcionalidades');
    const id = `sim.${randomBytes(8).toString('hex')}`;
    const payload =
      d.channel === 'WHATSAPP'
        ? { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: normalizePhone(d.from), profile: { name: d.name } }], messages: [{ from: normalizePhone(d.from), id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: d.text } }] } }] }] }
        : { object: d.channel === 'MESSENGER' ? 'page' : 'instagram', entry: [{ messaging: [{ sender: { id: d.from }, timestamp: Date.now(), message: { mid: id, text: d.text } }] }] };
    await audit(ctxOf(req), { entity: 'Conversation', action: 'simulate_inbound', after: d });
    return comms.processInbound(payload);
  });

}
