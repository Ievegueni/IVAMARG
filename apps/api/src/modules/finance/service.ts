import { computeCommission, formatKz, receivableStatus, type CommissionItem, type CommissionRule, type ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { notify, usersWithPermission } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { seesAll } from '../../lib/scope';
import { addTimeline } from '../../lib/timeline';
import { emitAutomation } from '../communication/automations';
import type { InvoiceItem } from '../invoices/service';
import type { PublicUser } from '../users/service';

const today = () => new Date(new Date().toISOString().slice(0, 10));
const withStatus = <T extends { amount: number; paid: number; dueDate: Date | null }>(r: T) => ({ ...r, balance: r.amount - r.paid, status: receivableStatus(r) });

// ─── Contas a receber ───

export async function listReceivables(u: PublicUser, q: ListQuery & { clientId?: string; status?: string }) {
  const own = seesAll(u, 'finance') ? {} : { clientId: { in: (await prisma.client.findMany({ where: { ownerId: u.id }, select: { id: true } })).map((c) => c.id) } };
  const where: Prisma.ReceivableWhereInput = {
    deletedAt: null,
    ...own,
    ...(q.clientId && { clientId: q.clientId }),
    // Estado é derivado (pago/vencimento): filtros traduzidos para condições.
    ...(q.status === 'PAID' && { paid: { gte: prisma.receivable.fields.amount } }),
    ...((q.status === 'OPEN_ALL' || q.status === 'OVERDUE') && { paid: { lt: prisma.receivable.fields.amount } }),
    ...(q.status === 'OVERDUE' && { dueDate: { lt: today() } }),
  };
  const [items, total, sums] = await Promise.all([
    prisma.receivable.findMany({ where, include: { invoice: { select: { number: true } } }, ...pageArgs(q, ['dueDate', 'amount', 'createdAt'], { dueDate: 'asc' }) }),
    prisma.receivable.count({ where }),
    prisma.receivable.aggregate({ where, _sum: { amount: true, paid: true } }),
  ]);
  const clients = new Map((await prisma.client.findMany({ where: { id: { in: items.map((i) => i.clientId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return { ...pageResult(items.map((r) => ({ ...withStatus(r), clientName: clients.get(r.clientId) })), total, q), totals: { amount: sums._sum.amount ?? 0, paid: sums._sum.paid ?? 0 } };
}

export async function getReceivable(u: PublicUser, id: string) {
  const r = await prisma.receivable.findFirst({ where: { id, deletedAt: null }, include: { payments: { orderBy: { paidAt: 'asc' } }, invoice: { select: { id: true, number: true } } } });
  if (!r) throw notFound('Conta a receber');
  if (!seesAll(u, 'finance')) {
    const c = await prisma.client.findUnique({ where: { id: r.clientId } });
    if (c?.ownerId !== u.id) throw forbidden();
  }
  return withStatus(r);
}

/** Pagamento parcial ou total. Gera receita (categoria "Recebimentos de clientes") e entra na timeline. */
export async function registerPayment(ctx: Ctx, u: PublicUser, receivableId: string, d: { amount: number; method: string; paidAt: Date; reference?: string | null; notes?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const [r] = await tx.$queryRaw<{ id: string; amount: number; paid: number; clientId: string; description: string; businessLineId: string | null }[]>`
      SELECT id, amount, paid, "clientId", description, "businessLineId" FROM "Receivable" WHERE id = ${receivableId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!r) throw notFound('Conta a receber');
    if (d.amount > r.amount - r.paid) throw new AppError(400, 'OVERPAYMENT', `Valor acima do saldo em dívida (${formatKz(r.amount - r.paid)})`);
    const p = await tx.payment.create({ data: { ...d, receivableId, userId: u.id } });
    await tx.receivable.update({ where: { id: receivableId }, data: { paid: r.paid + d.amount } });
    const cat = await tx.entryCategory.findFirstOrThrow({ where: { type: 'INCOME', name: 'Recebimentos de clientes' } });
    await tx.financialEntry.create({
      data: { type: 'INCOME', categoryId: cat.id, amount: d.amount, date: d.paidAt, description: `Recebimento - ${r.description}`, businessLineId: r.businessLineId, paymentId: p.id, createdById: u.id },
    });
    await addTimeline(tx, { clientId: r.clientId, title: `Pagamento recebido: ${formatKz(d.amount)} (${r.description})`, userId: u.id, entity: 'Payment', entityId: p.id });
    await audit(ctx, { entity: 'Payment', entityId: p.id, action: 'create', after: p }, tx);
    return p;
  });
}

/** Anular pagamento (erro de registo): repõe o saldo e remove a receita. Mantém o registo anulado. */
export async function cancelPayment(ctx: Ctx, paymentId: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.cancelledAt) throw notFound('Pagamento');
    await tx.payment.update({ where: { id: p.id }, data: { cancelledAt: new Date() } });
    await tx.receivable.update({ where: { id: p.receivableId }, data: { paid: { decrement: p.amount } } });
    await tx.financialEntry.updateMany({ where: { paymentId: p.id }, data: { deletedAt: new Date() } });
    await tx.commission.deleteMany({ where: { sourceType: 'Payment', sourceId: p.id, status: 'CALCULATED' } });
    await audit(ctx, { entity: 'Payment', entityId: p.id, action: 'cancel', before: p }, tx);
    return { ok: true };
  });
}

/** Job diário: contas vencidas e não pagas → automação "pagamento em atraso" + aviso ao financeiro (uma vez). */
export async function overdueAlert() {
  const due = await prisma.receivable.findMany({ where: { deletedAt: null, overdueNotifiedAt: null, dueDate: { lt: today() } } });
  const overdue = due.filter((r) => r.paid < r.amount);
  if (!overdue.length) return { overdue: 0 };
  for (const r of overdue) {
    await emitAutomation('PAYMENT_OVERDUE', { receivableId: r.id });
    await prisma.receivable.update({ where: { id: r.id }, data: { overdueNotifiedAt: new Date() } });
  }
  await notify(await usersWithPermission('finance.viewAll'), {
    title: `${overdue.length} conta(s) a receber em atraso`,
    body: `Total em dívida: ${formatKz(overdue.reduce((s, r) => s + r.amount - r.paid, 0))}`,
    link: '/financeiro?status=OVERDUE',
  });
  return { overdue: overdue.length };
}

// ─── Comissões ───

const periodRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  // Mês em Luanda (UTC+1): de 00:00 do dia 1 às 00:00 do mês seguinte.
  return { gte: new Date(Date.UTC(y, m - 1, 1) - 3600_000), lt: new Date(Date.UTC(y, m, 1) - 3600_000) };
};

/**
 * Recalcula as comissões do período: facturas emitidas (base "facturado") e pagamentos recebidos
 * (base "recebido"). Comissões já aprovadas/pagas não são tocadas.
 */
export async function calculateCommissions(ctx: Ctx, period: string) {
  const range = periodRange(period);
  const rules: CommissionRule[] = (await prisma.commissionRule.findMany({ where: { active: true } })).map((r) => ({ ...r, value: Number(r.value) }) as CommissionRule);
  const locked = new Set((await prisma.commission.findMany({ where: { period, status: { not: 'CALCULATED' } } })).map((c) => `${c.sourceType}:${c.sourceId}`));
  const invoices = await prisma.invoice.findMany({ where: { status: 'ISSUED', issuedAt: range, sellerId: { not: null } } });
  const payments = await prisma.payment.findMany({ where: { cancelledAt: null, paidAt: { gte: new Date(range.gte.getTime() + 3600_000), lt: new Date(range.lt.getTime() + 3600_000) } }, include: { receivable: { include: { invoice: true } } } });

  const rows: Prisma.CommissionCreateManyInput[] = [];
  const add = (sourceType: string, sourceId: string, inv: { sellerId: string | null; businessLineId: string | null; items: unknown; total: number }, base: 'INVOICED' | 'RECEIVED', share = 1) => {
    if (!inv.sellerId || locked.has(`${sourceType}:${sourceId}`)) return;
    const items = (inv.items as InvoiceItem[]).map<CommissionItem>((i) => ({ amount: Math.round(i.quantity * i.unitPrice), quantity: i.quantity, productModelId: i.productModelId }));
    const r = computeCommission({ sellerId: inv.sellerId, businessLineId: inv.businessLineId, items, share }, rules, base);
    if (r.amount > 0) rows.push({ userId: inv.sellerId, period, sourceType, sourceId, ruleId: r.ruleIds[0] ?? null, baseAmount: r.baseAmount, amount: r.amount });
  };
  for (const inv of invoices) add('Invoice', inv.id, inv, 'INVOICED');
  for (const p of payments) {
    const inv = p.receivable.invoice;
    if (inv) add('Payment', p.id, inv, 'RECEIVED', p.amount / inv.total);
  }
  await prisma.$transaction(async (tx) => {
    await tx.commission.deleteMany({ where: { period, status: 'CALCULATED' } });
    if (rows.length) await tx.commission.createMany({ data: rows });
    await audit(ctx, { entity: 'Commission', action: 'calculate', after: { period, count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) } }, tx);
  });
  return { count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) };
}

export async function listCommissions(u: PublicUser, q: { period?: string; userId?: string; status?: string }) {
  const where: Prisma.CommissionWhereInput = {
    ...(seesAll(u, 'finance') ? (q.userId ? { userId: q.userId } : {}) : { userId: u.id }), // comercial: só as suas
    ...(q.period && { period: q.period }),
    ...(q.status && { status: q.status }),
  };
  const items = await prisma.commission.findMany({ where, include: { rule: { select: { name: true } } }, orderBy: [{ period: 'desc' }, { createdAt: 'asc' }] });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const byUser = new Map<string, { userId: string; name: string; count: number; base: number; amount: number; approved: number; paid: number }>();
  for (const c of items) {
    const s = byUser.get(c.userId) ?? { userId: c.userId, name: users.get(c.userId) ?? '-', count: 0, base: 0, amount: 0, approved: 0, paid: 0 };
    s.count++;
    s.base += c.baseAmount;
    s.amount += c.amount;
    if (c.status === 'APPROVED') s.approved += c.amount;
    if (c.status === 'PAID') s.paid += c.amount;
    byUser.set(c.userId, s);
  }
  return { items: items.map((c) => ({ ...c, userName: users.get(c.userId) })), summary: [...byUser.values()].sort((a, b) => b.amount - a.amount) };
}

export async function setCommissionStatus(ctx: Ctx, ids: string[], status: 'APPROVED' | 'PAID') {
  const from = status === 'APPROVED' ? 'CALCULATED' : 'APPROVED';
  const r = await prisma.commission.updateMany({ where: { id: { in: ids }, status: from }, data: { status, ...(status === 'APPROVED' ? { approvedAt: new Date() } : { paidAt: new Date() }) } });
  await audit(ctx, { entity: 'Commission', action: status.toLowerCase(), after: { ids, updated: r.count } });
  return { updated: r.count };
}
