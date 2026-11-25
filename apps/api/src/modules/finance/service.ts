import { computeCommission, formatKz, payableSchema, receivableStatus, type CommissionItem, type CommissionRule, type ListQuery } from '@ivamarg/shared';
import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { notify, usersWithPermission } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { getSetting } from '../../lib/settings';
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

// ─── Fornecedores e prestadores: compras e dívidas ───

/** Fornecedores/prestadores com o saldo em dívida e o vencido. */
export async function listSuppliers(q: ListQuery) {
  const where: Prisma.SupplierWhereInput = { deletedAt: null, ...(q.search && { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { nif: { contains: q.search } }] }) };
  const [items, total] = await Promise.all([prisma.supplier.findMany({ where, ...pageArgs(q, ['name'], { name: 'asc' }) }), prisma.supplier.count({ where })]);
  const open = await prisma.payable.findMany({ where: { deletedAt: null, supplierId: { in: items.map((s) => s.id) }, paid: { lt: prisma.payable.fields.amount } }, select: { supplierId: true, amount: true, paid: true, dueDate: true } });
  const now = today();
  return pageResult(items.map((s) => {
    const mine = open.filter((p) => p.supplierId === s.id);
    return { ...s, balance: mine.reduce((t, p) => t + p.amount - p.paid, 0), overdue: mine.filter((p) => p.dueDate && p.dueDate < now).reduce((t, p) => t + p.amount - p.paid, 0) };
  }), total, q);
}

export async function listPayables(q: ListQuery & { supplierId?: string; status?: string }) {
  const where: Prisma.PayableWhereInput = {
    deletedAt: null,
    ...(q.supplierId && { supplierId: q.supplierId }),
    ...(q.status === 'PAID' && { paid: { gte: prisma.payable.fields.amount } }),
    ...((q.status === 'OPEN_ALL' || q.status === 'OVERDUE') && { paid: { lt: prisma.payable.fields.amount } }),
    ...(q.status === 'OVERDUE' && { dueDate: { lt: today() } }),
    ...(q.search && { OR: [{ description: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }, { supplier: { name: { contains: q.search, mode: 'insensitive' } } }] }),
  };
  const [items, total, sums] = await Promise.all([
    prisma.payable.findMany({ where, include: { supplier: { select: { id: true, name: true } }, category: { select: { name: true } } }, ...pageArgs(q, ['date', 'dueDate', 'amount'], { date: 'desc' }) }),
    prisma.payable.count({ where }),
    prisma.payable.aggregate({ where, _sum: { amount: true, paid: true } }),
  ]);
  return { ...pageResult(items.map(withStatus), total, q), totals: { amount: sums._sum.amount ?? 0, paid: sums._sum.paid ?? 0 } };
}

export async function getPayable(id: string) {
  const p = await prisma.payable.findFirst({ where: { id, deletedAt: null }, include: { supplier: { select: { id: true, name: true } }, category: { select: { name: true } }, payments: { orderBy: { paidAt: 'asc' } } } });
  if (!p) throw notFound('Dívida');
  return withStatus(p);
}

export async function createPayable(ctx: Ctx, d: z.output<typeof payableSchema>) {
  const { paidNow, ...data } = d;
  const cat = await prisma.entryCategory.findFirst({ where: { id: d.categoryId, type: 'EXPENSE' } });
  if (!cat) throw new AppError(400, 'INVALID_CATEGORY', 'Categoria de despesa inválida');
  const p = await prisma.payable.create({ data: { ...data, createdById: ctx.userId } });
  await audit(ctx, { entity: 'Payable', entityId: p.id, action: 'create', after: p });
  if (paidNow) await paySupplier(ctx, p.id, { amount: p.amount, method: paidNow.method, paidAt: p.date, reference: paidNow.reference });
  return getPayable(p.id);
}

/** Pagamento a fornecedor/prestador: abate a dívida e lança a despesa (categoria e centro de custo da dívida). */
export async function paySupplier(ctx: Ctx, payableId: string, d: { amount: number; method: string; paidAt: Date; reference?: string | null; notes?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const [p] = await tx.$queryRaw<{ id: string; amount: number; paid: number }[]>`SELECT id, amount, paid FROM "Payable" WHERE id = ${payableId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!p) throw notFound('Dívida');
    if (d.amount > p.amount - p.paid) throw new AppError(400, 'OVERPAYMENT', `Valor acima do saldo em dívida (${formatKz(p.amount - p.paid)})`);
    const full = await tx.payable.update({ where: { id: payableId }, data: { paid: p.paid + d.amount }, include: { supplier: { select: { name: true } } } });
    const sp = await tx.supplierPayment.create({ data: { ...d, payableId, userId: ctx.userId } });
    await tx.financialEntry.create({
      data: {
        type: 'EXPENSE', categoryId: full.categoryId, amount: d.amount, date: d.paidAt, description: `${full.supplier.name} - ${full.description}`,
        businessLineId: full.businessLineId, entity: full.entity, entityId: full.entityId, supplierId: full.supplierId, supplierPaymentId: sp.id, createdById: ctx.userId,
      },
    });
    await audit(ctx, { entity: 'SupplierPayment', entityId: sp.id, action: 'create', after: sp }, tx);
    return sp;
  });
}

export async function cancelSupplierPayment(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const sp = await tx.supplierPayment.findUnique({ where: { id } });
    if (!sp || sp.cancelledAt) throw notFound('Pagamento');
    await tx.supplierPayment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await tx.payable.update({ where: { id: sp.payableId }, data: { paid: { decrement: sp.amount } } });
    await tx.financialEntry.updateMany({ where: { supplierPaymentId: id }, data: { deletedAt: new Date() } });
    await audit(ctx, { entity: 'SupplierPayment', entityId: id, action: 'cancel', before: sp }, tx);
    return { ok: true };
  });
}

export async function deletePayable(ctx: Ctx, id: string) {
  const p = await getPayable(id);
  if (p.payments.some((x) => !x.cancelledAt)) throw new AppError(409, 'HAS_PAYMENTS', 'Anule primeiro os pagamentos desta dívida');
  await prisma.payable.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { entity: 'Payable', entityId: id, action: 'delete', before: p });
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

/**
 * Job diário: dívidas a fornecedores/prestadores a vencer (N dias antes, configurável) e vencidas
 * (no 1.º dia de atraso e depois semanalmente, sem estado guardado).
 */
export async function payablesAlert(today: Date) {
  const days = await getSetting<number>('finance.payablesAlertDays', 3);
  const open = (await prisma.payable.findMany({ where: { deletedAt: null, dueDate: { not: null } }, include: { supplier: { select: { name: true } } } })).filter((p) => p.paid < p.amount);
  const diff = (p: { dueDate: Date | null }) => Math.round((p.dueDate!.getTime() - today.getTime()) / 86400000);
  const soon = open.filter((p) => diff(p) === days);
  const late = open.filter((p) => diff(p) < 0 && (-diff(p) - 1) % 7 === 0);
  const to = await usersWithPermission('finance.viewAll');
  const line = (p: (typeof open)[number]) => `${p.supplier.name}: ${formatKz(p.amount - p.paid)} (${p.description})`;
  if (soon.length) await notify(to, { title: `${soon.length} pagamento(s) a fornecedores vencem em ${days} dia(s)`, body: soon.slice(0, 10).map(line).join(' · '), link: '/financeiro' });
  if (late.length) await notify(to, { title: `🔴 ${late.length} pagamento(s) a fornecedores em atraso`, body: late.slice(0, 10).map(line).join(' · '), link: '/financeiro' });
  return { soon: soon.length, late: late.length };
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
