import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Job } from 'bullmq';
import { logged } from '../jobs/integration-log';
import { env } from '../lib/env';

/** Valida o header X-Hub-Signature-256 ("sha256=<hex>") contra o corpo bruto. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const received = Buffer.from(header.slice(7));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export type InboundEvent =
  | { kind: 'message'; channel: 'WHATSAPP' | 'MESSENGER' | 'INSTAGRAM'; from: string; name?: string; externalId: string; type: string; text?: string; mediaId?: string; at: Date }
  | { kind: 'status'; externalId: string; status: string; error?: string }
  | { kind: 'call'; callId: string; from: string; to?: string; event: string; sdpType?: string; sdp?: string; duration?: number; at: Date };

/** Normaliza um webhook Meta (WhatsApp Cloud API, Messenger, Instagram) em eventos. */
export function parseWebhook(payload: any): InboundEvent[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: InboundEvent[] = [];
  for (const entry of payload?.entry ?? []) {
    if (payload.object === 'whatsapp_business_account') {
      for (const ch of entry.changes ?? []) {
        const v = ch.value ?? {};
        const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name])); // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const m of v.messages ?? []) {
          const media = m[m.type]?.id;
          out.push({
            kind: 'message', channel: 'WHATSAPP', from: m.from, name: names.get(m.from), externalId: m.id, at: new Date(Number(m.timestamp) * 1000),
            type: (m.type ?? 'text').toUpperCase(), text: m.text?.body ?? m[m.type]?.caption ?? (m.type === 'button' ? m.button?.text : undefined), mediaId: media,
          });
        }
        for (const st of v.statuses ?? []) {
          // Estados de chamadas também chegam em "statuses" (type: 'call'); ignorados aqui.
          if (st.type === 'call') continue;
          out.push({ kind: 'status', externalId: st.id, status: String(st.status).toUpperCase(), error: st.errors?.[0]?.title });
        }
        for (const c of v.calls ?? []) {
          out.push({ kind: 'call', callId: c.id, from: c.from, to: c.to, event: String(c.event), sdpType: c.session?.sdp_type, sdp: c.session?.sdp, duration: c.duration ? Number(c.duration) : undefined, at: new Date(Number(c.timestamp) * 1000) });
        }
      }
    } else if (payload.object === 'page' || payload.object === 'instagram') {
      const channel = payload.object === 'page' ? 'MESSENGER' : 'INSTAGRAM';
      for (const ev of entry.messaging ?? []) {
        if (!ev.message || ev.message.is_echo) continue;
        const att = ev.message.attachments?.[0];
        out.push({
          kind: 'message', channel, from: ev.sender.id, externalId: ev.message.mid, at: new Date(ev.timestamp),
          type: att ? String(att.type).toUpperCase() : 'TEXT', text: ev.message.text, mediaId: att?.payload?.url,
        });
      }
    }
  }
  return out;
}

const graph = (path: string) => `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`;

async function post(operation: string, url: string, token: string | undefined, body: unknown) {
  if (!token) throw new Error('Credenciais Meta em falta');
  return logged('meta', operation, body, async () => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Meta ${res.status}: ${data?.error?.message ?? 'erro'}`);
    return data;
  });
}

export type Outgoing = { text?: string; template?: { name: string; language: string; params: string[] }; media?: { type: 'image' | 'document'; link: string; filename?: string } };

/** Envio WhatsApp Cloud API: texto, template aprovado ou media por link. Devolve o wamid. */
export async function sendWhatsApp(to: string, m: Outgoing) {
  const base = { messaging_product: 'whatsapp', to };
  const body = m.template
    ? { ...base, type: 'template', template: { name: m.template.name, language: { code: m.template.language }, components: m.template.params.length ? [{ type: 'body', parameters: m.template.params.map((text) => ({ type: 'text', text })) }] : [] } }
    : m.media
      ? { ...base, type: m.media.type, [m.media.type]: { link: m.media.link, ...(m.media.filename && { filename: m.media.filename }), ...(m.text && { caption: m.text }) } }
      : { ...base, type: 'text', text: { body: m.text } };
  const r = await post('whatsapp.send', graph(`${env.WA_PHONE_NUMBER_ID}/messages`), env.WA_ACCESS_TOKEN, body);
  return r?.messages?.[0]?.id as string | undefined;
}

/** WhatsApp Calling: acções sobre uma chamada (pre_accept, accept, reject, terminate) ou nova chamada (connect). */
export async function callAction(body: { action: 'connect' | 'pre_accept' | 'accept' | 'reject' | 'terminate'; call_id?: string; to?: string; session?: { sdp_type: 'offer' | 'answer'; sdp: string } }) {
  const r = await post(`call.${body.action}`, graph(`${env.WA_PHONE_NUMBER_ID}/calls`), env.WA_ACCESS_TOKEN, { messaging_product: 'whatsapp', ...body });
  return r?.calls?.[0]?.id as string | undefined;
}

/** Messenger / Instagram: só resposta a mensagens recebidas (dentro de 24h). */
export async function sendPageMessage(recipientId: string, m: Outgoing) {
  const message = m.media ? { attachment: { type: m.media.type === 'image' ? 'image' : 'file', payload: { url: m.media.link } } } : { text: m.text };
  const r = await post('page.send', graph('me/messages'), env.FB_PAGE_ACCESS_TOKEN, { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message });
  return r?.message_id as string | undefined;
}

/** Fila meta-inbound: processa o webhook (ver modules/communication). */
export async function processMetaInbound(job: Job) {
  const { processInbound } = await import('../modules/communication/service');
  return processInbound(job.data);
}
