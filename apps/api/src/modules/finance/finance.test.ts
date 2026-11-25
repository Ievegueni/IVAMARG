import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues, queue } from '../../jobs/queues';
import { env } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { processVendus } from '../invoices/service';
import { processReport } from '../reports/routes';
import { calculateCommissions, overdueAlert, payablesAlert } from './service';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let admin: Api, fin: Api, comercial: Api, comercial2: Api;
const period = new Date().toISOString().slice(0, 7);
const job = (invoiceId: string) => ({ name: 'issue-invoice', data: { invoiceId }, attemptsMade: 0, opts: { attempts: 3 } }) as never;

/** Factura emitida (Vendus simulado) para um cliente do comercial → conta a receber. */
async function issued(owner: Api, total: number, dueDate?: string) {
  const client = (await owner.call('POST', '/clients', { name: `Cliente fin ${run} ${Math.random().toString(36).slice(2, 6)}` })).body;
  const order = (await admin.call('POST', '/orders', { clientId: client.id, lines: [{ description: 'Bata', quantity: 10, unitPrice: total / 10 }] })).body;
  await admin.call('PATCH', `/orders/${order.id}`, { status: 'READY' });
  const inv = (await admin.call('POST', '/invoices', { source: 'Order', sourceId: order.id, dueDate })).body;
  await processVendus(job(inv.id));
  return { client, inv: await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { receivable: true } }) };
}

beforeAll(async () => {
  app = await setupApp();
  admin = await userClient(app, 'Administrador');
  fin = await userClient(app, 'Financeiro');
  comercial = await userClient(app, 'Comercial');
  comercial2 = await userClient(app, 'Comercial');
  env.VENDUS_API_KEY = 'teste';
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/documents') ? Response.json({ id: ++n, number: `FT T/${run}/${n}` }) : Response.json({ id: 1 }))));
  await prisma.commissionRule.updateMany({ data: { active: false } });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.commissionRule.updateMany({ where: { name: { contains: run } }, data: { active: false } });
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

describe('contas a receber e pagamentos', () => {
  it('factura emitida cria conta a receber; pagamento parcial e total; não aceita pagar a mais', async () => {
    const { inv } = await issued(comercial, 100_000);
    const r = inv.receivable!;
    expect(r).toMatchObject({ amount: 100_000, paid: 0 });
    const p1 = await fin.call('POST', `/finance/receivables/${r.id}/payments`, { amount: 40_000, method: 'TRANSFER', paidAt: new Date().toISOString().slice(0, 10) });
    expect(p1.status).toBe(200);
    expect((await fin.call('GET', `/finance/receivables/${r.id}`)).body).toMatchObject({ paid: 40_000, balance: 60_000, status: 'PARTIAL' });
    expect((await fin.call('POST', `/finance/receivables/${r.id}/payments`, { amount: 70_000, method: 'CASH', paidAt: '2026-11-10' })).body.error.code).toBe('OVERPAYMENT');
    await fin.call('POST', `/finance/receivables/${r.id}/payments`, { amount: 60_000, method: 'TPA', paidAt: '2026-11-10' });
    expect((await fin.call('GET', `/finance/receivables/${r.id}`)).body.status).toBe('PAID');
    // recebimentos geram receitas
    expect(await prisma.financialEntry.count({ where: { paymentId: p1.body.id, type: 'INCOME', amount: 40_000 } })).toBe(1);
    // comercial vê as dos seus clientes; outro comercial não
    expect((await comercial.call('GET', `/finance/receivables/${r.id}`)).status).toBe(200);
    expect((await comercial2.call('GET', `/finance/receivables/${r.id}`)).status).toBe(403);
  });

  it('anular pagamento repõe saldo e remove a receita', async () => {
    const { inv } = await issued(comercial, 50_000);
    const p = (await fin.call('POST', `/finance/receivables/${inv.receivable!.id}/payments`, { amount: 50_000, method: 'CASH', paidAt: '2026-11-10' })).body;
    expect((await fin.call('POST', `/finance/payments/${p.id}/cancel`)).status).toBe(200);
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: inv.receivable!.id } })).paid).toBe(0);
    expect((await prisma.financialEntry.findFirstOrThrow({ where: { paymentId: p.id } })).deletedAt).not.toBeNull();
  });

  it('atraso: alerta uma vez e dispara a automação "pagamento em atraso"', async () => {
    const { inv } = await issued(comercial, 30_000, '2026-01-01');
    const before = await queue('automations').getJobCountByTypes('waiting', 'delayed');
    expect((await overdueAlert()).overdue).toBeGreaterThan(0);
    expect(await queue('automations').getJobCountByTypes('waiting', 'delayed')).toBeGreaterThan(before);
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: inv.receivable!.id } })).overdueNotifiedAt).not.toBeNull();
    expect((await overdueAlert()).overdue).toBe(0);
    expect((await fin.call('GET', '/finance/receivables?status=OVERDUE&pageSize=100')).body.items.some((x: { id: string }) => x.id === inv.receivable!.id)).toBe(true);
  });
});

describe('comissões', () => {
  it('facturado (2%) e recebido (fixo por documento), por comercial e período; aprovação e pagamento', async () => {
    await admin.call('POST', '/finance/commission-rules', { name: `Geral ${run}`, type: 'PERCENT', value: 2, base: 'INVOICED' });
    await admin.call('POST', '/finance/commission-rules', { name: `Recebido ${run}`, type: 'FIXED', value: 1500, base: 'RECEIVED', userId: comercial2.user.id });
    const a = await issued(comercial, 200_000);
    const b = await issued(comercial2, 80_000);
    await fin.call('POST', `/finance/receivables/${b.inv.receivable!.id}/payments`, { amount: 40_000, method: 'TRANSFER', paidAt: new Date().toISOString().slice(0, 10) });

    await calculateCommissions({}, period);
    const ca = await prisma.commission.findFirstOrThrow({ where: { sourceType: 'Invoice', sourceId: a.inv.id } });
    expect(ca).toMatchObject({ userId: comercial.user.id, amount: 4000, baseAmount: 200_000, status: 'CALCULATED' });
    const cp = await prisma.commission.findFirstOrThrow({ where: { sourceType: 'Payment', userId: comercial2.user.id, period } });
    expect(cp.amount).toBe(750); // 1.500 × 50% recebido

    // comercial só vê as suas
    const mine = (await comercial.call('GET', `/finance/commissions?period=${period}`)).body;
    expect(mine.items.every((c: { userId: string }) => c.userId === comercial.user.id)).toBe(true);
    // aprovar → recalcular não altera aprovadas → pagar
    expect((await comercial.call('POST', '/finance/commissions/status', { ids: [ca.id], status: 'APPROVED' })).status).toBe(403);
    await fin.call('POST', '/finance/commissions/status', { ids: [ca.id], status: 'APPROVED' });
    await calculateCommissions({}, period);
    expect((await prisma.commission.findUniqueOrThrow({ where: { id: ca.id } })).status).toBe('APPROVED');
    await fin.call('POST', '/finance/commissions/status', { ids: [ca.id], status: 'PAID' });
    expect((await prisma.commission.findUniqueOrThrow({ where: { id: ca.id } })).paidAt).not.toBeNull();
  });
});

describe('relatórios e KPIs', () => {
  const f = `from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`;
  it('vendas: comercial só vê as suas; financeiro vê todas', async () => {
    const own = (await comercial.call('GET', `/reports/data/sales?${f}`)).body;
    const all = (await fin.call('GET', `/reports/data/finance?${f}`)).status;
    expect(own.sections[0].rows.every((r: { name: string }) => r.name === comercial.user.name)).toBe(true);
    expect(all).toBe(200);
    expect((await comercial.call('GET', `/reports/data/finance?${f}`)).status).toBe(403);
  });

  it('KPIs com meta; exportação PDF e Excel pela fila', async () => {
    await admin.call('PUT', '/reports/kpi-targets', { kpiKey: 'sold_value', value: 1 });
    const k = (await admin.call('GET', `/reports/kpis?${f}`)).body.find((x: { key: string }) => x.key === 'sold_value');
    expect(k.value).toBeGreaterThan(0);
    expect(k.ok).toBe(true);
    for (const format of ['pdf', 'xlsx']) {
      const r = (await fin.call('POST', '/reports/export', { type: 'finance', format, filters: { from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString() } })).body;
      await processReport({ data: { reportId: r.id } } as never);
      const done = await prisma.report.findUniqueOrThrow({ where: { id: r.id } });
      expect(done.status).toBe('READY');
      const url = (await fin.call('GET', `/reports/exports/${r.id}/url`)).body.url;
      const file = await app.inject({ url });
      expect(file.rawPayload.subarray(0, 4).toString('latin1')).toBe(format === 'pdf' ? '%PDF' : 'PK\u0003\u0004');
    }
  });
});

describe('fornecedores e prestadores: compras e dívidas', () => {
  it('dívida → pagamentos parciais geram despesa; pago no acto; anular repõe; permissões', async () => {
    const s = await fin.call('POST', '/finance/suppliers', { name: `Segurança Lda ${run}`, nif: '5000000000' });
    expect(s.status).toBe(200);
    const cat = await prisma.entryCategory.findFirstOrThrow({ where: { type: 'EXPENSE', active: true } });
    const d = await fin.call('POST', '/finance/payables', { supplierId: s.body.id, categoryId: cat.id, description: 'Vigilância Novembro', reference: 'FT 12', amount: 300_000, date: '2026-11-01', dueDate: '2026-11-10' });
    expect(d.body).toMatchObject({ balance: 300_000, status: 'OVERDUE' });
    const p = await fin.call('POST', `/finance/payables/${d.body.id}/payments`, { amount: 100_000, method: 'TRANSFER', paidAt: '2026-11-20' });
    expect((await fin.call('POST', `/finance/payables/${d.body.id}/payments`, { amount: 250_000, method: 'CASH', paidAt: '2026-11-20' })).body.error.code).toBe('OVERPAYMENT');
    expect(await prisma.financialEntry.findFirst({ where: { supplierPaymentId: p.body.id } })).toMatchObject({ type: 'EXPENSE', amount: 100_000, supplierId: s.body.id, categoryId: cat.id });
    const list = (await fin.call('GET', `/finance/suppliers?search=${encodeURIComponent(`Segurança Lda ${run}`)}`)).body;
    expect(list.items[0]).toMatchObject({ balance: 200_000, overdue: 200_000 });

    // Compra paga no acto: dívida já liquidada e despesa lançada.
    const now = await fin.call('POST', '/finance/payables', { supplierId: s.body.id, categoryId: cat.id, description: 'Material de escritório', amount: 15_000, date: '2026-11-21', paidNow: { method: 'CASH' } });
    expect(now.body).toMatchObject({ paid: 15_000, status: 'PAID' });

    // Despesa automática não se edita à mão; anular o pagamento repõe o saldo e remove a despesa.
    const entry = await prisma.financialEntry.findFirstOrThrow({ where: { supplierPaymentId: p.body.id } });
    expect((await admin.call('DELETE', `/finance/entries/${entry.id}`)).status).toBe(404);
    expect((await fin.call('DELETE', `/finance/payables/${d.body.id}`)).body.error.code).toBe('HAS_PAYMENTS');
    await admin.call('POST', `/finance/supplier-payments/${p.body.id}/cancel`);
    expect((await fin.call('GET', `/finance/payables/${d.body.id}`)).body.balance).toBe(300_000);
    expect((await prisma.financialEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt).not.toBeNull();

    // Alertas: 3 dias antes do vencimento e no 1.º dia de atraso (depois semanal).
    expect((await payablesAlert(new Date('2026-11-07T00:00:00Z'))).soon).toBeGreaterThanOrEqual(1);
    expect((await payablesAlert(new Date('2026-11-11T00:00:00Z'))).late).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId: fin.user.id, title: { contains: 'fornecedores em atraso' } } })).toBeGreaterThanOrEqual(1);

    // Comercial (só as suas comissões) não vê dívidas a fornecedores.
    expect((await comercial.call('GET', '/finance/payables')).status).toBe(403);
  });
});
