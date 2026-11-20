import { CHANNEL_FLAG, CHANNELS, normalizePhone, renderTemplate, sendPolicy, templateVariables, type Channel, type ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { sendSms } from '../../integrations/futurix';
import { parseWebhook, sendPageMessage, sendWhatsApp, type Outgoing } from '../../integrations/meta';
import { logged } from '../../jobs/integration-log';
import { queue } from '../../jobs/queues';
import { audit, type Ctx } from '../../lib/audit';
import { env } from '../../lib/env';
import { AppError, notFound } from '../../lib/errors';
import { notify, usersWithPermission } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { seesAll } from '../../lib/scope';
import { getSetting, isEnabled } from '../../lib/settings';
import { signedUrl } from '../../lib/storage';
import { addTimeline } from '../../lib/timeline';
import type { PublicUser } from '../users/service';

const channelEnabled = async (c: Channel) => (CHANNEL_FLAG[c] ? isEnabled(CHANNEL_FLAG[c]!) : true);
export const sandbox = () => getSetting('comms.sandbox', true);

// ─── Acesso ───
/** Sem communication.viewAll: conversas atribuídas a mim ou de clientes da minha carteira. */
export async function conversationScope(u: PublicUser): Promise<Prisma.ConversationWhereInput> {
  if (seesAll(u, 'communication')) return {};
  const mine = (await prisma.client.findMany({ where: { ownerId: u.id }, select: { id: true } })).map((c) => c.id);
  return { OR: [{ assigneeId: u.id }, { clientId: { in: mine } }] };
}

export async function listConversations(u: PublicUser, q: ListQuery & { channel?: string; status?: string; assigneeId?: string; clientId?: string }) {
  const where: Prisma.ConversationWhereInput = {
    ...(await conversationScope(u)),
    ...(q.channel && { channel: q.channel as never }),
    ...(q.status && { status: q.status as never }),
    ...(q.assigneeId === 'none' ? { assigneeId: null } : q.assigneeId && { assigneeId: q.assigneeId }),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.search && { OR: [{ contactName: { contains: q.search, mode: 'insensitive' } }, { externalId: { contains: q.search } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: { assignee: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, direction: true, type: true } } },
      ...pageArgs(q, ['lastMessageAt'], { lastMessageAt: 'desc' }),
    }),
    prisma.conversation.count({ where }),
  ]);
  const clients = new Map((await prisma.client.findMany({ where: { id: { in: items.map((i) => i.clientId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return pageResult(items.map((c) => ({ ...c, clientName: c.clientId ? clients.get(c.clientId) : null })), total, q);
}

export async function getConversation(u: PublicUser, id: string) {
  const c = await prisma.conversation.findFirst({
    where: { id, ...(await conversationScope(u)) },
    include: { assignee: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 500 } },
  });
  if (!c) throw notFound('Conversa');
  if (c.unread) await prisma.conversation.update({ where: { id }, data: { unread: 0 } });
  const client = c.clientId ? await prisma.client.findUnique({ where: { id: c.clientId }, select: { id: true, name: true, ownerId: true } }) : null;
  const users = await prisma.user.findMany({ where: { id: { in: c.messages.map((m) => m.userId!).filter(Boolean) } }, select: { id: true, name: true } });
  const names = new Map(users.map((x) => [x.id, x.name]));
  return { ...c, client, policy: sendPolicy(c.channel, c.lastInboundAt), sandbox: await sandbox(), messages: c.messages.map((m) => ({ ...m, userName: m.userId ? names.get(m.userId) : null })) };
}

// ─── Recebidas ───

/** Encontra o cliente pelo contacto; se não existir, cria um lead (CLAUDE.md §5.11). */
export async function matchOrCreateClient(tx: Prisma.TransactionClient, channel: Channel, from: string, name?: string) {
  if (channel === 'WHATSAPP' || channel === 'SMS') {
    const phone = normalizePhone(from);
    const found = await tx.client.findFirst({ where: { deletedAt: null, phones: { has: phone } }, orderBy: { createdAt: 'asc' } });
    if (found) return { client: found, created: false };
    const client = await tx.client.create({ data: { name: name || `Lead WhatsApp +${phone}`, phones: [phone], tags: ['lead'] } });
    return { client, created: true };
  }
  if (channel === 'EMAIL') {
    const found = await tx.client.findFirst({ where: { deletedAt: null, email: from.toLowerCase() } });
    if (found) return { client: found, created: false };
    return { client: await tx.client.create({ data: { name: name || from, email: from.toLowerCase(), tags: ['lead'] } }), created: true };
  }
  const system = channel.toLowerCase();
  const ref = await tx.externalRef.findFirst({ where: { entity: 'Client', system, externalId: from } });
  if (ref) {
    const client = await tx.client.findUnique({ where: { id: ref.entityId } });
    if (client && !client.deletedAt) return { client, created: false };
  }
  const client = await tx.client.create({ data: { name: name || `Lead ${CHANNELS[channel]} ${from.slice(-6)}`, tags: ['lead'] } });
  await tx.externalRef.upsert({ where: { entity_entityId_system: { entity: 'Client', entityId: client.id, system } }, create: { entity: 'Client', entityId: client.id, system, externalId: from }, update: { externalId: from } });
  return { client, created: true };
}

/** Webhook Meta (via fila meta-inbound): grava mensagens e estados. Idempotente (wamid/mid único). */
export async function processInbound(payload: unknown) {
  let stored = 0;
  for (const ev of parseWebhook(payload)) {
    if (ev.kind === 'call') {
      const { handleCallEvent } = await import('./calls');
      await handleCallEvent(ev);
      continue;
    }
    if (ev.kind === 'status') {
      await prisma.message.updateMany({ where: { externalId: ev.externalId }, data: { status: ev.status, ...(ev.error && { error: ev.error }) } });
      continue;
    }
    if (!(await channelEnabled(ev.channel))) {
      await logged('meta', 'inbound.ignored', { channel: ev.channel, reason: 'canal desactivado' }, async () => null);
      continue;
    }
    if (await prisma.message.findUnique({ where: { externalId: ev.externalId } })) continue; // webhook repetido
    const externalId = ev.channel === 'WHATSAPP' ? normalizePhone(ev.from) : ev.from;
    const result = await prisma.$transaction(async (tx) => {
      let conv = await tx.conversation.findUnique({ where: { channel_externalId: { channel: ev.channel, externalId } } });
      let leadCreated = false;
      if (!conv || !conv.clientId) {
        const m = await matchOrCreateClient(tx, ev.channel, ev.from, ev.name);
        leadCreated = m.created;
        conv = conv
          ? await tx.conversation.update({ where: { id: conv.id }, data: { clientId: m.client.id } })
          : await tx.conversation.create({ data: { channel: ev.channel, externalId, contactName: ev.name, clientId: m.client.id, assigneeId: m.client.ownerId } });
      }
      const msg = await tx.message.create({
        data: { conversationId: conv.id, direction: 'IN', type: ev.type, body: ev.text, mediaId: ev.mediaId, externalId: ev.externalId, status: 'RECEIVED', createdAt: ev.at },
      });
      const updated = await tx.conversation.update({
        where: { id: conv.id },
        data: { lastInboundAt: ev.at, lastMessageAt: ev.at, unread: { increment: 1 }, status: 'OPEN', ...(ev.name && !conv.contactName && { contactName: ev.name }) },
      });
      await addTimeline(tx, {
        clientId: conv.clientId!,
        type: 'MESSAGE',
        title: `${CHANNELS[ev.channel]} recebido${leadCreated ? ' (novo lead)' : ''}`,
        body: ev.text?.slice(0, 300) ?? `[${ev.type.toLowerCase()}]`,
        entity: 'Conversation',
        entityId: conv.id,
        occurredAt: ev.at,
      });
      return { conv: updated, msg, leadCreated };
    });
    stored++;
    const to = result.conv.assigneeId ? [result.conv.assigneeId] : await usersWithPermission('communication.viewAll');
    await notify(to, {
      title: `${CHANNELS[ev.channel]}: ${ev.name ?? ev.from}${result.leadCreated ? ' (novo lead)' : ''}`,
      body: ev.text?.slice(0, 140) ?? 'Nova mensagem',
      link: `/comunicacao?c=${result.conv.id}`,
    });
  }
  return { stored };
}

// ─── Envio ───

async function templateVars(clientId: string | null, extra: Record<string, string> = {}) {
  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null;
  return { cliente: client?.name ?? '', empresa: await getSetting('company.name', 'Ivamarg'), ...extra };
}

export async function sendMessage(ctx: Ctx, u: PublicUser, conversationId: string, d: { body?: string; templateId?: string; note: boolean; attachmentDocumentId?: string }) {
  const conv = await getConversation(u, conversationId);
  if (d.note) {
    if (!d.body) throw new AppError(400, 'BODY_REQUIRED', 'Escreva a nota');
    const m = await prisma.message.create({ data: { conversationId, direction: 'NOTE', type: 'NOTE', body: d.body, status: 'NOTE', userId: u.id } });
    await audit(ctx, { entity: 'Conversation', entityId: conversationId, action: 'note' });
    return m;
  }
  const policy = sendPolicy(conv.channel, conv.lastInboundAt);
  if (policy.blocked) throw new AppError(409, 'WINDOW_CLOSED', `${CHANNELS[conv.channel]}: só é possível responder até 24h após a última mensagem do cliente`);
  if (!d.templateId && !policy.freeform) throw new AppError(409, 'TEMPLATE_REQUIRED', 'Fora da janela de 24h: use um template aprovado');
  if (!(await channelEnabled(conv.channel))) throw new AppError(409, 'CHANNEL_DISABLED', `Canal ${CHANNELS[conv.channel]} desactivado (Configurações → Funcionalidades)`);

  let body = d.body ?? '';
  let templateId: string | undefined;
  let vars: Record<string, string> | undefined;
  if (d.templateId) {
    const t = await prisma.messageTemplate.findFirst({ where: { id: d.templateId, active: true, channels: { has: conv.channel } } });
    if (!t) throw new AppError(400, 'INVALID_TEMPLATE', 'Template inválido para este canal');
    if (conv.channel === 'WHATSAPP' && !policy.freeform && !t.waTemplateName) throw new AppError(409, 'TEMPLATE_NOT_APPROVED', 'Este template não tem nome de template aprovado na Meta');
    vars = await templateVars(conv.clientId);
    body = renderTemplate(t.body, vars);
    templateId = t.id;
  }
  let mediaUrl: string | undefined;
  let type = templateId ? 'TEMPLATE' : 'TEXT';
  if (d.attachmentDocumentId) {
    const doc = await prisma.document.findFirst({ where: { id: d.attachmentDocumentId, deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!doc) throw notFound('Documento');
    const v = doc.versions[0];
    // Link público temporário (24h) para a Meta descarregar o ficheiro.
    const url = signedUrl(v.storageKey, 24 * 3600, v.filename);
    mediaUrl = url.startsWith('/') ? `${env.APP_URL}${url}` : url;
    type = v.mime.startsWith('image/') ? 'IMAGE' : 'DOCUMENT';
    body ||= doc.title;
  }
  if (!body && !mediaUrl) throw new AppError(400, 'BODY_REQUIRED', 'Mensagem vazia');
  const m = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { conversationId, direction: 'OUT', type, body, templateId, templateVars: vars, mediaUrl, status: 'QUEUED', userId: u.id } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), ...(!conv.assigneeId && { assigneeId: u.id }) } });
    if (conv.clientId) await addTimeline(tx, { clientId: conv.clientId, type: 'MESSAGE', title: `${CHANNELS[conv.channel]} enviado`, body: body.slice(0, 300), userId: u.id, entity: 'Conversation', entityId: conversationId });
    return m;
  });
  await audit(ctx, { entity: 'Message', entityId: m.id, action: 'send', after: { channel: conv.channel, type, templateId } });
  await queue('outbound').add('message', { channel: 'message', messageId: m.id });
  return m;
}

/** Fila outbound: envia uma mensagem de conversa. Sandbox = simula (sem chamar a Meta/Futurix). */
export async function deliverMessage(messageId: string, attempt: number, maxAttempts: number) {
  const m = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!m || m.status !== 'QUEUED') return;
  const c = m.conversation;
  try {
    if (!(await channelEnabled(c.channel))) throw new Error(`Canal ${CHANNELS[c.channel]} desactivado`);
    let externalId: string | undefined;
    const t = m.templateId ? await prisma.messageTemplate.findUnique({ where: { id: m.templateId } }) : null;
    if (c.channel === 'EMAIL') {
      const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
      const subject = t?.subject ? renderTemplate(t.subject, await templateVars(c.clientId)) : `Mensagem de ${await getSetting('company.name', 'Ivamarg')}`;
      const r = await logged('smtp', 'conversation.send', { to: c.externalId, subject }, () =>
        transport.sendMail({ from: env.SMTP_FROM, to: c.externalId, subject, text: m.body ?? '', ...(m.mediaUrl && { attachments: [{ path: m.mediaUrl }] }) }),
      );
      externalId = r.messageId;
    } else if (await sandbox()) {
      await logged(c.channel === 'SMS' ? 'futurix' : 'meta', 'send.simulated', { channel: c.channel, to: c.externalId, body: m.body }, async () => ({ simulated: true }));
      await prisma.message.update({ where: { id: m.id }, data: { status: 'SIMULATED' } });
      return;
    } else {
      const out: Outgoing =
        t?.waTemplateName && c.channel === 'WHATSAPP' && !sendPolicy(c.channel, c.lastInboundAt).freeform
          ? { template: { name: t.waTemplateName, language: t.waLanguage, params: templateVariables(t.body).map((k) => String((m.templateVars as Record<string, string> | null)?.[k] ?? '')) } }
          : { text: m.body ?? undefined, ...(m.mediaUrl && { media: { type: m.type === 'IMAGE' ? 'image' : 'document', link: m.mediaUrl } }) };
      externalId =
        c.channel === 'WHATSAPP' ? await sendWhatsApp(c.externalId, out)
        : c.channel === 'SMS' ? String((await sendSms(c.externalId, m.body ?? ''))?.id ?? '') || undefined
        : await sendPageMessage(c.externalId, out);
    }
    await prisma.message.update({ where: { id: m.id }, data: { status: 'SENT', externalId: externalId || null } });
  } catch (err) {
    if (attempt + 1 >= maxAttempts || String(err).includes('desactivado')) {
      await prisma.message.update({ where: { id: m.id }, data: { status: 'FAILED', error: String((err as Error).message).slice(0, 300) } });
      if (m.userId) await notify([m.userId], { title: `Falha no envio (${CHANNELS[c.channel]})`, body: (err as Error).message, link: `/comunicacao?c=${c.id}` });
      if (String(err).includes('desactivado')) return;
    }
    throw err;
  }
}
