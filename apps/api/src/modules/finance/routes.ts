import { commissionRuleSchema, entrySchema, listQuerySchema, payableSchema, paymentSchema, periodSchema, receivableSchema, supplierSchema } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { getClient } from '../clients/service';
import * as fin from './service';

type Id = { Params: { id: string } };

export async function financeRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard('finance.view') };
  const create = { preHandler: app.guard('finance.create') };
  const all = { preHandler: app.guard('finance.viewAll') };

  // ── Contas a receber ──
  app.get('/receivables', view, (req) => fin.listReceivables(req.currentUser!, listQuerySchema.extend({ clientId: z.string().optional(), status: z.string().optional() }).parse(req.query)));
  app.get<Id>('/receivables/:id', view, (req) => fin.getReceivable(req.currentUser!, req.params.id));
  app.post('/receivables', create, async (req) => {
    const d = receivableSchema.parse(req.body);
    await getClient(req.currentUser!, d.clientId);
    const r = await prisma.receivable.create({ data: { ...d, createdById: req.currentUser!.id } });
    await audit(ctxOf(req), { entity: 'Receivable', entityId: r.id, action: 'create', after: r });
    return r;
  });
  app.post<Id>('/receivables/:id/payments', create, (req) => fin.registerPayment(ctxOf(req), req.currentUser!, req.params.id, paymentSchema.parse(req.body)));
  app.post<Id>('/payments/:id/cancel', { preHandler: app.guard('finance.delete') }, (req) => fin.cancelPayment(ctxOf(req), req.params.id));

  // ── Fornecedores / prestadores de serviço: compras e dívidas ──
  app.get('/suppliers', all, (req) => fin.listSuppliers(listQuerySchema.parse(req.query)));
  app.post('/suppliers', create, async (req) => {
    const s = await prisma.supplier.create({ data: { ...supplierSchema.parse(req.body), createdById: req.currentUser!.id } });
    await audit(ctxOf(req), { entity: 'Supplier', entityId: s.id, action: 'create', after: s });
    return s;
  });
  app.patch<Id>('/suppliers/:id', { preHandler: app.guard('finance.edit') }, async (req) => {
    const before = await prisma.supplier.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!before) throw notFound('Fornecedor');
    const after = await prisma.supplier.update({ where: { id: before.id }, data: supplierSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'Supplier', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.get('/payables', all, (req) => fin.listPayables(listQuerySchema.extend({ supplierId: z.string().optional(), status: z.string().optional() }).parse(req.query)));
  app.get<Id>('/payables/:id', all, (req) => fin.getPayable(req.params.id));
  app.post('/payables', create, (req) => fin.createPayable(ctxOf(req), payableSchema.parse(req.body)));
  app.delete<Id>('/payables/:id', { preHandler: app.guard('finance.delete') }, async (req) => {
    await fin.deletePayable(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>('/payables/:id/payments', create, (req) => fin.paySupplier(ctxOf(req), req.params.id, paymentSchema.parse(req.body)));
  app.post<Id>('/supplier-payments/:id/cancel', { preHandler: app.guard('finance.delete') }, (req) => fin.cancelSupplierPayment(ctxOf(req), req.params.id));

  // ── Receitas e despesas ──
  app.get('/entries', all, async (req) => {
    const q = listQuerySchema.extend({ type: z.string().optional(), categoryId: z.string().optional(), businessLineId: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), entity: z.string().optional(), entityId: z.string().optional() }).parse(req.query);
    const where: Prisma.FinancialEntryWhereInput = {
      deletedAt: null,
      ...(q.type && { type: q.type }),
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(q.businessLineId && { businessLineId: q.businessLineId }),
      ...(q.entity && q.entityId && { entity: q.entity, entityId: q.entityId }),
      ...((q.from || q.to) && { date: { gte: q.from, lte: q.to } }),
      ...(q.search && { description: { contains: q.search, mode: 'insensitive' } }),
    };
    const [items, total, byType] = await Promise.all([
      prisma.financialEntry.findMany({ where, include: { category: { select: { name: true } } }, ...pageArgs(q, ['date', 'amount'], { date: 'desc' }) }),
      prisma.financialEntry.count({ where }),
      prisma.financialEntry.groupBy({ by: ['type'], where, _sum: { amount: true } }),
    ]);
    const sum = (t: string) => byType.find((b) => b.type === t)?._sum.amount ?? 0;
    return { ...pageResult(items, total, q), totals: { income: sum('INCOME'), expense: sum('EXPENSE'), net: sum('INCOME') - sum('EXPENSE') } };
  });
  app.post('/entries', create, async (req) => {
    const e = await prisma.financialEntry.create({ data: { ...entrySchema.parse(req.body), createdById: req.currentUser!.id } });
    await audit(ctxOf(req), { entity: 'FinancialEntry', entityId: e.id, action: 'create', after: e });
    return e;
  });
  app.patch<Id>('/entries/:id', { preHandler: app.guard('finance.edit') }, async (req) => {
    const before = await prisma.financialEntry.findFirst({ where: { id: req.params.id, deletedAt: null, paymentId: null, supplierPaymentId: null, salaryPaymentId: null } });
    if (!before) throw notFound('Movimento (recebimentos e pagamentos a fornecedores editam-se no pagamento)');
    const after = await prisma.financialEntry.update({ where: { id: before.id }, data: entrySchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'FinancialEntry', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.delete<Id>('/entries/:id', { preHandler: app.guard('finance.delete') }, async (req) => {
    const before = await prisma.financialEntry.findFirst({ where: { id: req.params.id, deletedAt: null, paymentId: null, supplierPaymentId: null, salaryPaymentId: null } });
    if (!before) throw notFound('Movimento');
    await prisma.financialEntry.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
    await audit(ctxOf(req), { entity: 'FinancialEntry', entityId: before.id, action: 'delete', before });
    return { ok: true };
  });
  app.get('/categories', view, () => prisma.entryCategory.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }));
  app.post('/categories', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const c = await prisma.entryCategory.create({ data: z.object({ name: z.string().trim().min(2), type: z.enum(['INCOME', 'EXPENSE']) }).parse(req.body) });
    await audit(ctxOf(req), { entity: 'EntryCategory', entityId: c.id, action: 'create', after: c });
    return c;
  });

  // ── Comissões ──
  app.get('/commission-rules', all, () => prisma.commissionRule.findMany({ orderBy: { name: 'asc' } }));
  app.post('/commission-rules', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const r = await prisma.commissionRule.create({ data: commissionRuleSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'CommissionRule', entityId: r.id, action: 'create', after: r });
    return r;
  });
  app.patch<Id>('/commission-rules/:id', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const before = await prisma.commissionRule.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Regra');
    const after = await prisma.commissionRule.update({ where: { id: before.id }, data: commissionRuleSchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'CommissionRule', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.get('/commissions', view, (req) => fin.listCommissions(req.currentUser!, z.object({ period: z.string().optional(), userId: z.string().optional(), status: z.string().optional() }).parse(req.query)));
  app.post('/commissions/calculate', { preHandler: app.guard('finance.edit') }, (req) => fin.calculateCommissions(ctxOf(req), periodSchema.parse((req.body as { period?: string })?.period)));
  app.post('/commissions/status', { preHandler: app.guard('finance.approve') }, (req) => {
    const b = z.object({ ids: z.array(z.string()).min(1), status: z.enum(['APPROVED', 'PAID']) }).parse(req.body);
    return fin.setCommissionStatus(ctxOf(req), b.ids, b.status);
  });

  // ── Painel financeiro ──
  app.get('/dashboard', all, async () => {
    const now = new Date();
    const open = await prisma.receivable.findMany({ where: { deletedAt: null } });
    const pending = open.filter((r) => r.paid < r.amount);
    const day = 86400000;
    const aging = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    for (const r of pending) {
      const late = r.dueDate ? Math.floor((now.getTime() - r.dueDate.getTime()) / day) : -1;
      const bal = r.amount - r.paid;
      if (late < 1) aging.current += bal;
      else if (late <= 30) aging.d30 += bal;
      else if (late <= 60) aging.d60 += bal;
      else if (late <= 90) aging.d90 += bal;
      else aging.over90 += bal;
    }
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const month = await prisma.financialEntry.groupBy({ by: ['type'], where: { deletedAt: null, date: { gte: monthStart } }, _sum: { amount: true } });
    const payables = await prisma.payable.findMany({ where: { deletedAt: null, paid: { lt: prisma.payable.fields.amount } }, select: { amount: true, paid: true, dueDate: true } });
    const today = new Date(now.toISOString().slice(0, 10));
    const commissions = await prisma.commission.groupBy({ by: ['status'], _sum: { amount: true } });
    const topDebtors = new Map<string, number>();
    for (const r of pending) topDebtors.set(r.clientId, (topDebtors.get(r.clientId) ?? 0) + r.amount - r.paid);
    const top = [...topDebtors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const names = new Map((await prisma.client.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return {
      openTotal: pending.reduce((s, r) => s + r.amount - r.paid, 0),
      overdueTotal: aging.d30 + aging.d60 + aging.d90 + aging.over90,
      aging,
      monthIncome: month.find((m) => m.type === 'INCOME')?._sum.amount ?? 0,
      monthExpense: month.find((m) => m.type === 'EXPENSE')?._sum.amount ?? 0,
      commissions: Object.fromEntries(commissions.map((c) => [c.status, c._sum.amount ?? 0])),
      payablesOpen: payables.reduce((s, p) => s + p.amount - p.paid, 0),
      payablesOverdue: payables.filter((p) => p.dueDate && p.dueDate < today).reduce((s, p) => s + p.amount - p.paid, 0),
      topDebtors: top.map(([id, amount]) => ({ id, name: names.get(id) ?? '-', amount })),
    };
  });
}
