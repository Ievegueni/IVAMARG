import { TIMEZONE } from '@ivamarg/shared';
import type { Job } from 'bullmq';
import { notify, usersWithPermission } from '../lib/notify';
import { prisma } from '../lib/prisma';
import { getSetting } from '../lib/settings';
import { emitAutomation } from '../modules/communication/automations';
import { D } from '../modules/stock/core';
import { queue } from './queues';

/** Agenda os alertas diários (idempotente: pode correr a cada arranque do worker). */
export async function scheduleAlerts() {
  const q = queue('alerts');
  await q.upsertJobScheduler('min-stock', { pattern: '0 7 * * *', tz: TIMEZONE }, { name: 'min-stock' });
  await q.upsertJobScheduler('documents-expiry', { pattern: '10 7 * * *', tz: TIMEZONE }, { name: 'documents-expiry' });
  await q.upsertJobScheduler('task-reminders', { pattern: '0 7,13 * * *', tz: TIMEZONE }, { name: 'task-reminders' });
  await q.upsertJobScheduler('payments-overdue', { pattern: '20 7 * * *', tz: TIMEZONE }, { name: 'payments-overdue' });
}

export async function minStockAlert() {
  const items = await prisma.stockItem.findMany({ where: { active: true, deletedAt: null, minStock: { gt: 0 } }, include: { levels: true } });
  const low = items
    .map((i) => ({ i, available: i.levels.reduce((s, l) => s.plus(l.onHand).minus(l.reserved), D(0)) }))
    .filter(({ i, available }) => available.lt(i.minStock));
  if (!low.length) return { low: 0 };
  const perm = await getSetting('stock.alertRoles', 'stock.edit');
  await notify(await usersWithPermission(perm), {
    title: `Stock mínimo: ${low.length} artigo(s) abaixo do mínimo`,
    body: low.slice(0, 10).map(({ i, available }) => `${i.code} ${available.toString()}/${i.minStock.toString()} ${i.unit}`).join(' · '),
    link: '/stock?belowMin=1',
  });
  return { low: low.length };
}

/** Data de hoje em Luanda (00:00 UTC desse dia, como as colunas @db.Date). */
export const todayLuanda = (now = new Date()) => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now)}T00:00:00Z`);

/**
 * Validade de documentos: alerta quando faltam exactamente N dias (limiares configuráveis) ou expirou.
 * `lastAlertDays` evita repetir o mesmo alerta; se o job falhar um dia, o limiar seguinte apanha.
 */
export async function documentsExpiryAlert(now = new Date()) {
  const thresholds = [...(await getSetting<number[]>('documents.alertDays', [30, 15, 7]))].sort((a, b) => b - a);
  const today = todayLuanda(now);
  const horizon = new Date(today.getTime() + (thresholds[0] ?? 0) * 86400000);
  const docs = await prisma.document.findMany({ where: { deletedAt: null, expiresAt: { not: null, lte: horizon } }, include: { category: true } });
  const recipients = await usersWithPermission('documents.edit');
  const users = await prisma.user.findMany({ where: { id: { in: recipients } }, include: { role: true } });
  let sent = 0;
  for (const d of docs) {
    const days = Math.round((d.expiresAt!.getTime() - today.getTime()) / 86400000);
    // Menor limiar já atingido (ex.: faltam 12 dias → limiar 15); expirado → 0.
    const level = days <= 0 ? 0 : thresholds.filter((t) => days <= t).at(-1);
    if (level === undefined || (d.lastAlertDays !== null && d.lastAlertDays <= level)) continue;
    const canSee = users.filter((u) => u.role.isAdmin || !d.category.roleIds.length || d.category.roleIds.includes(u.roleId)).map((u) => u.id);
    const to = [...new Set([...canSee, ...(d.createdById ? [d.createdById] : [])])];
    await notify(to, {
      title: days <= 0 ? `Documento expirado: ${d.title}` : `Documento expira em ${days} dia(s): ${d.title}`,
      body: `${d.category.name} · validade ${d.expiresAt!.toISOString().slice(0, 10).split('-').reverse().join('/')}`,
      link: `/documentos?id=${d.id}`,
    });
    await prisma.document.update({ where: { id: d.id }, data: { lastAlertDays: level } });
    await emitAutomation('DOCUMENT_EXPIRING', { documentId: d.id });
    sent++;
  }
  return { sent };
}

/** Lembretes de tarefas: a vencer nas próximas 24h ou em atraso (no máximo 1 lembrete por dia). */
export async function taskReminders(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 20 * 3600_000);
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { in: ['TODO', 'IN_PROGRESS'] },
      dueAt: { not: null, lte: new Date(now.getTime() + 24 * 3600_000) },
      OR: [{ remindedAt: null }, { remindedAt: { lt: dayAgo } }],
    },
  });
  for (const t of tasks) {
    const late = t.dueAt! < now;
    await notify([t.assigneeId], { title: late ? `Tarefa em atraso: ${t.title}` : `Tarefa a vencer: ${t.title}`, link: '/tarefas' });
    await prisma.task.update({ where: { id: t.id }, data: { remindedAt: now } });
    await emitAutomation('TASK_DUE', { taskId: t.id });
  }
  return { reminded: tasks.length };
}

export async function processAlerts(job: Job) {
  if (job.name === 'min-stock') return minStockAlert();
  if (job.name === 'documents-expiry') return documentsExpiryAlert();
  if (job.name === 'task-reminders') return taskReminders();
  if (job.name === 'payments-overdue') return (await import('../modules/finance/service')).overdueAlert();
}
