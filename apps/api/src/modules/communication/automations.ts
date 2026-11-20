import { formatDate, formatKz, normalizePhone, renderTemplate, templateVariables, type AutomationTrigger, type Channel } from '@ivamarg/shared';
import type { Job } from 'bullmq';
import { sendSms } from '../../integrations/futurix';
import { sendWhatsApp } from '../../integrations/meta';
import { logged } from '../../jobs/integration-log';
import { sendEmail } from '../../jobs/outbound';
import { queue } from '../../jobs/queues';
import { usersWithPermission } from '../../lib/notify';
import { prisma } from '../../lib/prisma';
import { getSetting, isEnabled } from '../../lib/settings';
import { sandbox } from './service';

type Ctx = { clientId?: string | null; assigneeIds: string[]; vars: Record<string, string> };

/** Dispara as automações de um gatilho (assíncrono, fila `automations`). Nunca falha a operação de origem. */
export async function emitAutomation(trigger: AutomationTrigger, data: Record<string, string>) {
  await queue('automations').add(trigger, data).catch(() => {});
}

async function contextFor(trigger: AutomationTrigger, d: Record<string, string>): Promise<Ctx | null> {
  const company = await getSetting('company.name', 'Ivamarg');
  const base = { empresa: company };
  switch (trigger) {
    case 'PROPOSAL_SENT': {
      const p = await prisma.proposal.findUnique({ where: { id: d.proposalId }, include: { client: true } });
      return p && { clientId: p.clientId, assigneeIds: [p.ownerId].filter(Boolean) as string[], vars: { ...base, cliente: p.client.name, proposta: p.number, valor: formatKz(p.total) } };
    }
    case 'ORDER_READY': {
      const o = await prisma.order.findUnique({ where: { id: d.orderId }, include: { client: true } });
      return o && { clientId: o.clientId, assigneeIds: [o.client.ownerId].filter(Boolean) as string[], vars: { ...base, cliente: o.client.name, encomenda: o.number, valor: formatKz(o.total), prazo: o.deadline ? formatDate(o.deadline) : '' } };
    }
    case 'TASK_DUE': {
      const t = await prisma.task.findUnique({ where: { id: d.taskId } });
      return t && { clientId: t.clientId, assigneeIds: [t.assigneeId], vars: { ...base, tarefa: t.title, prazo: t.dueAt ? formatDate(t.dueAt) : '' } };
    }
    case 'DOCUMENT_EXPIRING': {
      const doc = await prisma.document.findUnique({ where: { id: d.documentId }, include: { links: { where: { entity: 'Client' } } } });
      return doc && { clientId: doc.links[0]?.entityId ?? null, assigneeIds: [doc.createdById].filter(Boolean) as string[], vars: { ...base, documento: doc.title, prazo: doc.expiresAt ? formatDate(doc.expiresAt) : '' } };
    }
    case 'PAYMENT_OVERDUE': {
      const r = await prisma.receivable.findUnique({ where: { id: d.receivableId } });
      if (!r) return null;
      const c = await prisma.client.findUnique({ where: { id: r.clientId } });
      return { clientId: r.clientId, assigneeIds: [c?.ownerId].filter(Boolean) as string[], vars: { ...base, cliente: c?.name ?? '', valor: formatKz(r.amount - r.paid), prazo: r.dueDate ? formatDate(r.dueDate) : '' } };
    }
  }
}

/** Fila automations: para cada automação activa do gatilho, envia o template ao destinatário configurado. */
export async function processAutomation(job: Job<Record<string, string>>) {
  const trigger = job.name as AutomationTrigger;
  const autos = await prisma.automation.findMany({ where: { trigger, active: true, template: { active: true } }, include: { template: true } });
  if (!autos.length) return { sent: 0 };
  const ctx = await contextFor(trigger, job.data);
  if (!ctx) return { sent: 0 };
  let sent = 0;
  for (const a of autos) {
    const channel = a.channel as Channel;
    const flag = { WHATSAPP: 'meta.whatsapp', SMS: 'sms', MESSENGER: 'meta.messenger', INSTAGRAM: 'meta.instagram', EMAIL: null }[channel];
    if (flag && !(await isEnabled(flag))) continue;
    const vars = { ...ctx.vars };
    if (a.recipient === 'CLIENT') {
      if (!ctx.clientId) continue;
      const client = await prisma.client.findUnique({ where: { id: ctx.clientId } });
      vars.cliente ??= client?.name ?? '';
      const to = channel === 'EMAIL' ? client?.email : channel === 'WHATSAPP' || channel === 'SMS' ? client?.phones[0] : null;
      if (!to) continue; // Messenger/Instagram não permitem iniciar conversa
      const externalId = channel === 'EMAIL' ? to.toLowerCase() : normalizePhone(to);
      const conv = await prisma.conversation.upsert({
        where: { channel_externalId: { channel, externalId } },
        create: { channel, externalId, contactName: client!.name, clientId: client!.id, assigneeId: client!.ownerId },
        update: { lastMessageAt: new Date() },
      });
      const m = await prisma.message.create({
        data: { conversationId: conv.id, direction: 'OUT', type: 'TEMPLATE', body: renderTemplate(a.template.body, vars), templateId: a.templateId, templateVars: vars, status: 'QUEUED' },
      });
      await queue('outbound').add('message', { channel: 'message', messageId: m.id });
      sent++;
    } else {
      const ids = a.recipient === 'DIRECTION' ? await usersWithPermission('reports.viewAll') : ctx.assigneeIds;
      const users = await prisma.user.findMany({ where: { id: { in: ids }, active: true } });
      for (const u of users) {
        const text = renderTemplate(a.template.body, vars);
        if (channel === 'EMAIL') await sendEmail(u.email, renderTemplate(a.template.subject ?? a.name, vars), `<p>${text}</p>`);
        else if (u.phone) await queue('outbound').add('direct', { channel: 'direct', via: channel, to: normalizePhone(u.phone), text, waTemplate: a.template.waTemplateName, waLanguage: a.template.waLanguage, params: templateVariables(a.template.body).map((k) => vars[k] ?? '') });
        else continue;
        sent++;
      }
    }
  }
  return { sent };
}

/** Envio directo a um utilizador (alertas internos por WhatsApp/SMS), fora das conversas. */
export async function deliverDirect(d: { via: Channel; to: string; text: string; waTemplate?: string | null; waLanguage?: string; params?: string[] }) {
  if (await sandbox()) return logged(d.via === 'SMS' ? 'futurix' : 'meta', 'direct.simulated', d, async () => ({ simulated: true }));
  if (d.via === 'SMS') return sendSms(d.to, d.text);
  if (d.via === 'WHATSAPP') {
    // Utilizador interno sem conversa aberta: fora da janela, só com template aprovado.
    if (!d.waTemplate) throw new Error('Alerta WhatsApp requer template aprovado (nome do template Meta)');
    return sendWhatsApp(d.to, { template: { name: d.waTemplate, language: d.waLanguage ?? 'pt_PT', params: d.params ?? [] } });
  }
}
