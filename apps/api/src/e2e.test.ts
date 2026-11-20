import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run, setupApp, userClient } from '../test/helpers';
import { closeQueues } from './jobs/queues';
import { env } from './lib/env';
import { prisma } from './lib/prisma';
import { calculateCommissions } from './modules/finance/service';
import { processVendus } from './modules/invoices/service';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
const roles = ['Administrador', 'Gestor', 'Comercial', 'Produção/Stock', 'Financeiro'] as const;
const as: Record<(typeof roles)[number], Api> = {} as never;

beforeAll(async () => {
  app = await setupApp();
  for (const r of roles) as[r] = await userClient(app, r);
  env.VENDUS_API_KEY = 'teste';
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/documents') ? Response.json({ id: `e2e-${++n}`, number: `FT E2E/${run}/${n}` }) : Response.json({ id: `c-${run}` }))));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

describe('fluxo completo: comercial → produção → factura → pagamento → comissão', () => {
  it('percorre todos os módulos com os perfis certos', async () => {
    const { Comercial: com, Gestor: gest, 'Produção/Stock': prod, Financeiro: fin } = as;
    const wh = (await prisma.warehouse.findFirstOrThrow({ where: { code: 'PRINCIPAL' } })).id;
    const uniforms = await prisma.businessLine.findFirstOrThrow({ where: { kind: 'UNIFORMS' }, include: { pipelineStages: true } });
    await prisma.setting.update({ where: { key: 'proposals.approvalThreshold' }, data: { value: 100_000 } });
    await as.Administrador.call('POST', '/finance/commission-rules', { name: `E2E ${run}`, type: 'PERCENT', value: 3, base: 'RECEIVED', userId: com.user.id });

    // Comercial: cliente → oportunidade → proposta (acima do limite)
    const client = (await com.call('POST', '/clients', { name: `Escola E2E ${run}`, phones: [`93${run.slice(0, 7).replace(/\D/g, '1').padEnd(7, '1')}`] })).body;
    const opp = (await com.call('POST', '/opportunities', { title: 'Fardas 2027', clientId: client.id, businessLineId: uniforms.id, value: 120_000 })).body;
    const prop = (await com.call('POST', '/proposals', { title: 'Fardas', clientId: client.id, businessLineId: uniforms.id, opportunityId: opp.id, items: [{ description: 'Camisa', quantity: 12, unitPrice: 10_000 }] })).body;
    expect((await com.call('POST', `/proposals/${prop.id}/submit`)).body.status).toBe('PENDING_APPROVAL');
    // Gestor aprova; comercial envia; cliente aceita → encomenda
    expect((await gest.call('POST', `/proposals/${prop.id}/approve`, { comment: 'ok' })).body.status).toBe('APPROVED');
    await com.call('POST', `/proposals/${prop.id}/send`);
    const accepted = (await com.call('POST', `/proposals/${prop.id}/accept`)).body;
    const orderId = accepted.order.id;
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id }, include: { stage: true } })).stage.isWon).toBe(true);

    // Produção: ficha técnica, stock, grelha de tamanhos, OP, libertação, saída de material
    const tec = (await prod.call('POST', '/stock/items', { code: `E2E-TEC-${run}`.toUpperCase(), name: 'Tecido E2E', unit: 'm' })).body;
    await prod.call('POST', '/stock/movements', { type: 'IN', itemId: tec.id, warehouseId: wh, quantity: 50, unitCost: 1500 });
    const model = (await prod.call('POST', '/catalog', { reference: `E2E-CAM-${run}`.toUpperCase(), name: 'Camisa E2E', bom: [{ stockItemId: tec.id, consumption: 1.5 }] })).body;
    const order = (await prod.call('GET', `/orders/${orderId}`)).body;
    expect((await prod.call('PATCH', `/orders/${orderId}`, { lines: [{ description: order.lines[0].description, productModelId: model.id, sizeGrid: { M: 8, L: 4 }, unitPrice: order.lines[0].unitPrice }] })).status).toBe(200);
    const po = (await prod.call('POST', '/production/orders', { orderId })).body[0];
    const released = (await prod.call('POST', `/production/orders/${po.id}/release`, {})).body;
    expect(released.status).toBe('RELEASED');
    await prod.call('POST', `/production/orders/${po.id}/issue`, { lines: [{ itemId: tec.id, quantity: 18 }] });

    // Chão de fábrica (escritório em nome do operador): todas as etapas de todos os lotes
    const op = (await as.Administrador.call('POST', '/production/config/operators', { name: 'Op E2E', code: `E2E-${run}`.toUpperCase(), payModel: 'PIECE' })).body;
    for (const lot of released.lots) {
      for (const st of released.stages) {
        const log = await prod.call('POST', '/production/logs', { lotId: lot.id, stageId: st.id, quantity: lot.quantity, operatorId: op.id });
        expect(log.status, JSON.stringify(log.body) + st.name).toBe(200);
        expect((await prod.call('POST', `/production/logs/${log.body.id}/finish`, { qtyDone: lot.quantity })).status).toBe(200);
      }
    }
    const done = (await prod.call('POST', `/production/orders/${po.id}/complete`)).body;
    expect(done.costs).toMatchObject({ material: 27_000, pieces: 12 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');

    // Financeiro: factura (Vendus simulado) → conta a receber → pagamento → comissão do comercial
    const inv = (await fin.call('POST', '/invoices', { source: 'Order', sourceId: orderId })).body;
    await processVendus({ name: 'issue-invoice', data: { invoiceId: inv.id }, attemptsMade: 0, opts: { attempts: 3 } } as never);
    const rec = await prisma.receivable.findUniqueOrThrow({ where: { invoiceId: inv.id } });
    expect(rec.amount).toBe(120_000);
    await fin.call('POST', `/finance/receivables/${rec.id}/payments`, { amount: 120_000, method: 'TRANSFER', paidAt: new Date().toISOString().slice(0, 10) });
    expect((await fin.call('GET', `/finance/receivables/${rec.id}`)).body.status).toBe('PAID');
    await calculateCommissions({}, new Date().toISOString().slice(0, 7));
    const c = await prisma.commission.findFirstOrThrow({ where: { userId: com.user.id, sourceType: 'Payment' } });
    expect(c.amount).toBe(3600);
    // Timeline do cliente tem o percurso todo
    const tl = await prisma.timelineEvent.findMany({ where: { clientId: client.id }, select: { title: true } });
    for (const s of ['Cliente criado', 'Proposta', 'Encomenda', 'Factura', 'Pagamento recebido']) expect(tl.some((t) => t.title.includes(s))).toBe(true);
  });
});

describe('matriz de permissões (CLAUDE.md §7)', () => {
  // [método, url, perfis com acesso]
  const A = 'Administrador', G = 'Gestor', C = 'Comercial', P = 'Produção/Stock', F = 'Financeiro';
  const matrix: [string, string, string[]][] = [
    ['GET', '/backoffice/settings', [A, G]],
    ['GET', '/users', [A, G]],
    ['GET', '/audit', [A, G]],
    ['GET', '/clients', [A, G, C, P, F]],
    ['GET', '/proposals', [A, G, C, F]],
    ['GET', '/opportunities', [A, G, C, F]],
    ['GET', '/production/orders', [A, G, C, P, F]],
    ['GET', '/orders', [A, G, C, P, F]],
    ['GET', '/stock/items', [A, G, C, P, F]],
    ['GET', '/stock/suppliers', [A, G, C, P, F]],
    ['GET', '/documents', [A, G, C, P, F]],
    ['GET', '/communication/conversations', [A, G, C, F]],
    ['GET', '/finance/receivables', [A, G, C, F]],
    ['GET', '/finance/entries', [A, G, F]],
    ['GET', '/finance/dashboard', [A, G, F]],
    ['GET', '/dashboard/direction', [A, G, F]],
    ['GET', '/dashboard/production', [A, G, C, P, F]],
    ['GET', '/operations/projects', [A, G, C, P, F]],
    ['GET', '/tasks', [A, G, C, P, F]],
  ];
  it.each(matrix)('%s %s', async (method, url, allowed) => {
    for (const r of roles) {
      const status = (await as[r].call(method as 'GET', url)).status;
      expect.soft(status, `${r} ${method} ${url}`).toBe(allowed.includes(r) ? 200 : 403);
    }
  });

  it('escritas sensíveis', async () => {
    const item = await prisma.stockItem.findFirstOrThrow();
    const wh = await prisma.warehouse.findFirstOrThrow();
    for (const r of roles) {
      const s = (await as[r].call('POST', '/stock/movements', { type: 'ADJUSTMENT', itemId: item.id, warehouseId: wh.id, delta: 0.001, notes: 'teste permissões' })).status;
      expect.soft(s, `${r} ajuste de stock`).toBe(['Administrador', 'Gestor', 'Produção/Stock'].includes(r) ? 200 : 403);
      const b = (await as[r].call('PATCH', '/backoffice/settings/company.name', { value: 'Ivamarg, Lda' })).status;
      expect.soft(b, `${r} editar configurações`).toBe(r === 'Administrador' ? 200 : 403);
    }
  });
});

describe('migração: importação de artigos com stock inicial', () => {
  it('pré-visualiza, valida e cria com entrada de stock e custo médio', async () => {
    const wh = (await prisma.warehouse.findFirstOrThrow({ where: { code: 'PRINCIPAL' } })).id;
    const code = `IMP-${run}`.toUpperCase();
    const rows = [
      { Código: code, Nome: 'Linha branca', Unidade: 'un', Categoria: 'Consumível', 'Stock mínimo': '10', Quantidade: '25', 'Custo unitário': '350' },
      { Código: code, Nome: 'Repetido', Unidade: 'un' },
      { Código: `${code}-2`, Nome: 'Sem custo', Unidade: 'm', Quantidade: '5' },
    ];
    const pre = (await as['Produção/Stock'].call('POST', '/stock/items/import', { warehouseId: wh, rows, dryRun: true })).body;
    expect(pre.summary).toEqual({ total: 3, ok: 1, duplicate: 1, error: 1 });
    const done = (await as['Produção/Stock'].call('POST', '/stock/items/import', { warehouseId: wh, rows, dryRun: false })).body;
    expect(done.created).toBe(1);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { code }, include: { levels: true } });
    expect(item).toMatchObject({ category: 'CONSUMABLE', unit: 'un' });
    expect(Number(item.avgCost)).toBe(350);
    expect(Number(item.levels[0].onHand)).toBe(25);
  });
});

describe('performance das listagens (< 500 ms)', () => {
  it('com 5.000 clientes', async () => {
    const n = await prisma.client.count();
    if (n < 5000) {
      await prisma.client.createMany({ data: Array.from({ length: 5000 - n }, (_, i) => ({ name: `Carga ${i} ${run}`, phones: [`2449${String(i).padStart(8, '0')}`], tags: i % 7 ? [] : ['vip'] })) });
    }
    const admin = as.Administrador;
    const timed = async (url: string) => {
      const t = performance.now();
      const r = await admin.call('GET', url);
      expect(r.status).toBe(200);
      return Math.round(performance.now() - t);
    };
    await timed('/clients'); // aquecimento
    const results = {
      clients: await timed('/clients?page=40'),
      search: await timed('/clients?search=Carga%2012'),
      tag: await timed('/clients?tag=vip'),
      proposals: await timed('/proposals'),
      stock: await timed('/stock/items'),
      direction: await timed('/dashboard/direction'),
      audit: await timed('/audit'),
    };
    console.table(results);
    for (const [k, ms] of Object.entries(results)) expect.soft(ms, k).toBeLessThan(500);
  });
});
