import { normalizePhone } from '@ivamarg/shared';
import { randomBytes } from 'node:crypto';
import { callAction, type InboundEvent } from '../../integrations/meta';
import { logged } from '../../jobs/integration-log';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { notify, usersWithPermission } from '../../lib/notify';
import { prisma } from '../../lib/prisma';
import { isEnabled } from '../../lib/settings';
import { addTimeline } from '../../lib/timeline';
import type { PublicUser } from '../users/service';
import { conversationScope, matchOrCreateClient, sandbox } from './service';

// Chamadas WhatsApp (Cloud API Calling, WebRTC no browser). Atrás da flag `whatsapp.calls`.
// Sinalização: a Meta envia o SDP da chamada no webhook; o browser gera a resposta e a API reencaminha-a.

const enabled = () => isEnabled('whatsapp.calls');
async function assertEnabled() {
  if (!(await enabled())) throw new AppError(409, 'CALLS_DISABLED', 'Chamadas WhatsApp desactivadas (Configurações → Funcionalidades)');
}

/** Envia acção à Meta, ou simula em sandbox. */
async function meta(body: Parameters<typeof callAction>[0]) {
  if (await sandbox()) {
    await logged('meta', `call.${body.action}.simulated`, { action: body.action, call_id: body.call_id }, async () => ({ simulated: true }));
    return body.action === 'connect' ? `sim-call-${randomBytes(6).toString('hex')}` : body.call_id;
  }
  return callAction(body);
}

async function finish(callId: string, status: string, duration?: number, userId?: string | null, result?: string | null) {
  const call = await prisma.callLog.findUnique({ where: { id: callId }, include: { conversation: true } });
  if (!call || call.endedAt) return call;
  const endedAt = new Date();
  const durationSec = duration ?? (call.answeredAt ? Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000) : 0);
  const finalStatus = call.status === 'RINGING' && status === 'ENDED' ? 'MISSED' : status;
  return prisma.$transaction(async (tx) => {
    const after = await tx.callLog.update({ where: { id: callId }, data: { status: finalStatus, endedAt, durationSec, ...(result && { result }) } });
    if (call.conversation.clientId) {
      const label = { ENDED: 'terminada', MISSED: 'não atendida', REJECTED: 'rejeitada', FAILED: 'falhou' }[finalStatus] ?? finalStatus.toLowerCase();
      const mins = `${Math.floor(durationSec / 60)}m${String(durationSec % 60).padStart(2, '0')}s`;
      await addTimeline(tx, {
        clientId: call.conversation.clientId,
        type: 'CALL',
        title: `Chamada WhatsApp ${call.direction === 'IN' ? 'recebida' : 'efectuada'} - ${label}${durationSec ? ` (${mins})` : ''}`,
        body: after.result,
        userId: userId ?? call.userId ?? undefined,
        entity: 'CallLog',
        entityId: call.id,
      });
    }
    return after;
  });
}

/** Eventos de chamada vindos do webhook (via processInbound). */
export async function handleCallEvent(ev: Extract<InboundEvent, { kind: 'call' }>) {
  if (!(await enabled())) return;
  const existing = await prisma.callLog.findUnique({ where: { externalId: ev.callId } });
  if (ev.event === 'connect' && !existing) {
    // Chamada recebida do cliente: SDP offer para o browser responder.
    const phone = normalizePhone(ev.from);
    const conv = await prisma.$transaction(async (tx) => {
      const found = await tx.conversation.findUnique({ where: { channel_externalId: { channel: 'WHATSAPP', externalId: phone } } });
      if (found?.clientId) return found;
      const { client } = await matchOrCreateClient(tx, 'WHATSAPP', phone);
      return found
        ? tx.conversation.update({ where: { id: found.id }, data: { clientId: client.id } })
        : tx.conversation.create({ data: { channel: 'WHATSAPP', externalId: phone, clientId: client.id, assigneeId: client.ownerId } });
    });
    const call = await prisma.callLog.create({ data: { conversationId: conv.id, externalId: ev.callId, direction: 'IN', offerSdp: ev.sdp, startedAt: ev.at } });
    await notify(conv.assigneeId ? [conv.assigneeId] : await usersWithPermission('communication.viewAll'), { title: `Chamada WhatsApp de +${phone}`, link: `/comunicacao?c=${conv.id}&call=${call.id}` });
    return;
  }
  if (!existing) return;
  if (ev.event === 'connect' && existing.direction === 'OUT' && ev.sdpType === 'answer') {
    // Cliente atendeu a nossa chamada: SDP answer para o browser.
    await prisma.callLog.update({ where: { id: existing.id }, data: { answerSdp: ev.sdp, status: 'ACCEPTED', answeredAt: ev.at } });
  } else if (ev.event === 'terminate') {
    await finish(existing.id, 'ENDED', ev.duration);
  }
}

async function getCall(u: PublicUser, id: string) {
  const call = await prisma.callLog.findFirst({ where: { id, conversation: await conversationScope(u) }, include: { conversation: true } });
  if (!call) throw notFound('Chamada');
  return call;
}

/** Chamadas a tocar ou em curso visíveis ao utilizador (o browser faz polling). */
export async function activeCalls(u: PublicUser) {
  if (!(await enabled())) return [];
  return prisma.callLog.findMany({
    where: { endedAt: null, status: { in: ['RINGING', 'ACCEPTED'] }, conversation: await conversationScope(u), startedAt: { gt: new Date(Date.now() - 2 * 3600_000) } },
    include: { conversation: { select: { id: true, externalId: true, contactName: true, clientId: true } } },
    orderBy: { startedAt: 'desc' },
  });
}

export async function acceptCall(ctx: Ctx, u: PublicUser, id: string, answerSdp: string) {
  await assertEnabled();
  const call = await getCall(u, id);
  if (call.direction !== 'IN' || call.status !== 'RINGING') throw new AppError(409, 'INVALID_STATE', 'Chamada já atendida ou terminada');
  const session = { sdp_type: 'answer' as const, sdp: answerSdp };
  await meta({ action: 'pre_accept', call_id: call.externalId!, session });
  await meta({ action: 'accept', call_id: call.externalId!, session });
  const after = await prisma.callLog.update({ where: { id }, data: { status: 'ACCEPTED', answerSdp, answeredAt: new Date(), userId: u.id } });
  await prisma.conversation.update({ where: { id: call.conversationId }, data: { assigneeId: call.conversation.assigneeId ?? u.id } });
  await audit(ctx, { entity: 'CallLog', entityId: id, action: 'accept' });
  return after;
}

export async function rejectCall(ctx: Ctx, u: PublicUser, id: string) {
  await assertEnabled();
  const call = await getCall(u, id);
  if (call.status !== 'RINGING') throw new AppError(409, 'INVALID_STATE', 'Chamada já não está a tocar');
  await meta({ action: 'reject', call_id: call.externalId! });
  await audit(ctx, { entity: 'CallLog', entityId: id, action: 'reject' });
  return finish(id, 'REJECTED', 0, u.id);
}

export async function endCall(ctx: Ctx, u: PublicUser, id: string, result?: string | null) {
  const call = await getCall(u, id);
  if (call.endedAt) return call;
  if (call.externalId) await meta({ action: 'terminate', call_id: call.externalId }).catch(() => undefined);
  await audit(ctx, { entity: 'CallLog', entityId: id, action: 'terminate' });
  return finish(id, 'ENDED', undefined, u.id, result);
}

/** Chamada efectuada: só com consentimento do cliente registado (CLAUDE.md §5.11). */
export async function startCall(ctx: Ctx, u: PublicUser, conversationId: string, offerSdp: string) {
  await assertEnabled();
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, ...(await conversationScope(u)) } });
  if (!conv) throw notFound('Conversa');
  if (conv.channel !== 'WHATSAPP') throw new AppError(400, 'NOT_WHATSAPP', 'Chamadas só por WhatsApp');
  if (!conv.callConsentAt) throw new AppError(409, 'NO_CONSENT', 'O cliente ainda não autorizou chamadas da empresa');
  const externalId = await meta({ action: 'connect', to: conv.externalId, session: { sdp_type: 'offer', sdp: offerSdp } });
  const call = await prisma.callLog.create({ data: { conversationId, externalId, direction: 'OUT', offerSdp, userId: u.id } });
  await audit(ctx, { entity: 'CallLog', entityId: call.id, action: 'connect' });
  // Sandbox: o "cliente" atende logo (sem áudio) para testar o fluxo e o registo.
  if (await sandbox()) return prisma.callLog.update({ where: { id: call.id }, data: { status: 'ACCEPTED', answeredAt: new Date() } });
  return call;
}

export async function setConsent(ctx: Ctx, u: PublicUser, conversationId: string, granted: boolean) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, ...(await conversationScope(u)) } });
  if (!conv) throw notFound('Conversa');
  await prisma.conversation.update({ where: { id: conv.id }, data: { callConsentAt: granted ? new Date() : null } });
  await audit(ctx, { entity: 'Conversation', entityId: conv.id, action: granted ? 'call_consent_granted' : 'call_consent_revoked' });
  return { ok: true };
}

/** Sandbox: simula uma chamada recebida (mesmo caminho que o webhook). */
export async function simulateIncoming(from: string) {
  await assertEnabled();
  if (!(await sandbox())) throw new AppError(409, 'NOT_SANDBOX', 'Disponível apenas em modo sandbox');
  const callId = `sim-in-${randomBytes(6).toString('hex')}`;
  await handleCallEvent({ kind: 'call', callId, from: normalizePhone(from), event: 'connect', sdpType: 'offer', sdp: undefined, at: new Date() });
  return prisma.callLog.findUnique({ where: { externalId: callId } });
}
