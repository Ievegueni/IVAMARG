import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { env } from '../lib/env';
import { logged } from './integration-log';
import { queue } from './queues';

type EmailJob = { channel: 'email'; to: string; subject: string; html: string };
type MessageJob = { channel: 'message'; messageId: string };
type DirectJob = { channel: 'direct'; via: 'WHATSAPP' | 'SMS'; to: string; text: string; waTemplate?: string | null; waLanguage?: string; params?: string[] };

export const sendEmail = (to: string, subject: string, html: string) =>
  queue('outbound').add('email', { channel: 'email', to, subject, html } satisfies EmailJob);

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

/** Fila outbound: emails de sistema, mensagens de conversas (WhatsApp/Messenger/Instagram/SMS/email) e alertas directos. */
export async function processOutbound(job: Job<EmailJob | MessageJob | DirectJob>) {
  const d = job.data;
  if (d.channel === 'message') {
    const { deliverMessage } = await import('../modules/communication/service');
    return deliverMessage(d.messageId, job.attemptsMade, job.opts.attempts ?? 1);
  }
  if (d.channel === 'direct') {
    const { deliverDirect } = await import('../modules/communication/automations');
    return deliverDirect(d);
  }
  await logged('smtp', 'send', { to: d.to, subject: d.subject }, () => transport.sendMail({ from: env.SMTP_FROM, to: d.to, subject: d.subject, html: d.html }));
}
