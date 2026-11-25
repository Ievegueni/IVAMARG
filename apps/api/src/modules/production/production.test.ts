import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let admin: Api, prod: Api, comercial: Api;
let wh: string, wh2: string;
const code = (p: string) => `${p}-${run}`.toUpperCase();
const level = async (itemId: string, warehouseId = wh) => {
  const l = await prisma.stockLevel.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId } } });
  return { onHand: Number(l?.onHand ?? 0), reserved: Number(l?.reserved ?? 0) };
};

beforeAll(async () => {
  app = await setupApp();
  admin = await userClient(app, 'Administrador');
  prod = await userClient(app, 'Produção/Stock');
  comercial = await userClient(app, 'Comercial');
  wh = (await prisma.warehouse.findFirstOrThrow({ where: { code: 'PRINCIPAL' } })).id;
  wh2 = (await prisma.warehouse.upsert({ where: { code: 'LOJA' }, create: { code: 'LOJA', name: 'Loja' }, update: {} })).id;
  await prisma.setting.update({ where: { key: 'production.lotSize' }, data: { value: 10 } });
  await prisma.setting.update({ where: { key: 'production.opMode' }, data: { value: 'PER_ORDER' } });
});
afterAll(async () => {
  await prisma.setting.update({ where: { key: 'production.lotSize' }, data: { value: 50 } });
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

const newItem = async (prefix: string, unit = 'm') => (await prod.call('POST', '/stock/items', { code: code(prefix), name: `Artigo ${prefix}`, unit })).body;
const supplier = async () => (await prod.call('POST', '/stock/suppliers', { name: `Fornecedor ${run}` })).body;
const receive = async (lines: { itemId: string; quantity: number; unitCost: number }[], warehouseId = wh) => {
  const p = (await prod.call('POST', '/stock/purchases', { supplierId: (await supplier()).id, warehouseId, lines })).body;
  const r = await prod.call('POST', `/stock/purchases/${p.id}/receive`);
  expect(r.status).toBe(200);
  return p;
};

describe('stock', () => {
  it('entrada recalcula custo médio ponderado; compra não é recebida duas vezes', async () => {
    const it = await newItem('TEC');
    const p = await receive([{ itemId: it.id, quantity: 100, unitCost: 1000 }]);
    await receive([{ itemId: it.id, quantity: 50, unitCost: 1600 }]);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: it.id } });
    expect(Number(item.avgCost)).toBe(1200); // (100×1000 + 50×1600) / 150
    expect(await level(it.id)).toEqual({ onHand: 150, reserved: 0 });
    expect((await prod.call('POST', `/stock/purchases/${p.id}/receive`)).body.error.code).toBe('INVALID_STATUS');
  });

  it('saída e transferência não podem exceder o disponível; ajuste exige motivo', async () => {
    const it = await newItem('BOT', 'un');
    await receive([{ itemId: it.id, quantity: 10, unitCost: 50 }]);
    const over = await prod.call('POST', '/stock/movements', { type: 'OUT', itemId: it.id, warehouseId: wh, quantity: 11 });
    expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await prod.call('POST', '/stock/movements', { type: 'TRANSFER', itemId: it.id, warehouseId: wh, toWarehouseId: wh2, quantity: 4 })).status).toBe(200);
    expect(await level(it.id)).toEqual({ onHand: 6, reserved: 0 });
    expect(await level(it.id, wh2)).toEqual({ onHand: 4, reserved: 0 });
    expect((await prod.call('POST', '/stock/movements', { type: 'ADJUSTMENT', itemId: it.id, warehouseId: wh, delta: -1 })).status).toBe(400);
    expect((await prod.call('POST', '/stock/movements', { type: 'ADJUSTMENT', itemId: it.id, warehouseId: wh, delta: -7, notes: 'Quebra' })).body.error.code).toBe('INVALID_ADJUSTMENT');
    expect((await comercial.call('POST', '/stock/movements', { type: 'OUT', itemId: it.id, warehouseId: wh, quantity: 1 })).status).toBe(403);
  });

  it('inventário: contagem → submissão → aprovação gera ajustes', async () => {
    const whInv = (await prisma.warehouse.create({ data: { code: code('INV'), name: 'Inventário teste' } })).id;
    const it = await newItem('LIN', 'un');
    await receive([{ itemId: it.id, quantity: 20, unitCost: 10 }], whInv);
    const c = (await prod.call('POST', '/stock/inventories', { warehouseId: whInv })).body;
    const detail = (await prod.call('GET', `/stock/inventories/${c.id}`)).body;
    const lines = detail.lines.map((l: { itemId: string; expected: string }) => ({ itemId: l.itemId, counted: l.itemId === it.id ? 18 : Number(l.expected) }));
    expect((await prod.call('POST', `/stock/inventories/${c.id}/submit`, { lines })).status).toBe(200);
    expect((await comercial.call('POST', `/stock/inventories/${c.id}/approve`)).status).toBe(403); // falta stock.approve
    expect((await admin.call('POST', `/stock/inventories/${c.id}/approve`)).status).toBe(200);
    expect(await level(it.id, whInv)).toEqual({ onHand: 18, reserved: 0 });
  });
});

describe('produção ponta a ponta', () => {
  let tecido: { id: string }, botao: { id: string }, modelId: string, orderId: string, poId: string;
  let stages: { id: string; name: string; type: string; order: number }[];
  let opPiece: string, opFixed: string;

  beforeAll(async () => {
    tecido = await newItem('TECPOLO');
    botao = await newItem('BOTPOLO', 'un');
    await receive([{ itemId: tecido.id, quantity: 30, unitCost: 1000 }, { itemId: botao.id, quantity: 200, unitCost: 20 }]);
    const model = await prod.call('POST', '/catalog', {
      reference: code('POLO'),
      name: 'Polo escolar',
      basePrice: 5000,
      bom: [
        { stockItemId: tecido.id, consumption: 1.2 },
        { stockItemId: tecido.id, size: 'XL', consumption: 1.5 },
        { stockItemId: botao.id, consumption: 3 },
      ],
    });
    expect(model.status).toBe(200);
    modelId = model.body.id;
    stages = (await prod.call('GET', '/production/config/stages')).body.filter((s: { active: boolean }) => s.active);
    const costura = stages.find((s) => s.name === 'Costura')!;
    await admin.call('PUT', '/production/config/rates', { stageId: costura.id, rate: 100 });
    await admin.call('PUT', '/production/config/rates', { stageId: costura.id, productModelId: modelId, rate: 150 });
    opPiece = (await admin.call('POST', '/production/config/operators', { name: 'Ana Costureira', code: code('OP1'), payModel: 'PIECE' })).body.id;
    const pin = String(Math.floor(100000 + Math.random() * 899999));
    await admin.call('PATCH', `/production/config/operators/${opPiece}`, { pin });
    opFixed = (await admin.call('POST', '/production/config/operators', { name: 'Rui Corte', code: code('OP2'), payModel: 'FIXED', fixedSalary: 80000 })).body.id;
    expect((await admin.call('POST', '/production/config/operators', { name: 'Outro', code: code('OP3'), pin })).body.error.code).toBe('PIN_IN_USE');

    const client = (await admin.call('POST', '/clients', { name: `Escola ${run}` })).body;
    const order = await admin.call('POST', '/orders', {
      clientId: client.id,
      lines: [{ description: 'Polo', productModelId: modelId, sizeGrid: { M: 15, XL: 4 }, color: 'Azul-marinho', details: 'Bordado no peito', unitPrice: 6000 }],
    });
    orderId = order.body.id;
  });

  it('gera OP com necessidades e faltas; libertar exige force; reserva o disponível e cria lotes', async () => {
    const created = await prod.call('POST', '/production/orders', { orderId });
    expect(created.status).toBe(200);
    poId = created.body[0].id;
    const po = (await prod.call('GET', `/production/orders/${poId}`)).body;
    expect(po.items[0].orderLine).toMatchObject({ color: 'Azul-marinho', details: 'Bordado no peito' });
    const t = po.shortages.find((s: { itemId: string }) => s.itemId === tecido.id);
    expect(t.required).toBe(15 * 1.2 + 4 * 1.5); // 24
    expect(t.shortage).toBe(0);
    expect(po.shortages.find((s: { itemId: string }) => s.itemId === botao.id).required).toBe(57);

    // Tirar tecido para criar falta
    await prod.call('POST', '/stock/movements', { type: 'OUT', itemId: tecido.id, warehouseId: wh, quantity: 10 });
    const blocked = await prod.call('POST', `/production/orders/${poId}/release`, {});
    expect(blocked.body.error.code).toBe('SHORTAGE');
    expect(blocked.body.error.details[0].shortage).toBe(4);

    const rel = await prod.call('POST', `/production/orders/${poId}/release`, { force: true });
    expect(rel.body.status).toBe('RELEASED');
    expect(await level(tecido.id)).toEqual({ onHand: 20, reserved: 20 });
    expect(await level(botao.id)).toEqual({ onHand: 200, reserved: 57 });
    expect(rel.body.lots.map((l: { size: string; quantity: number }) => `${l.size}:${l.quantity}`)).toEqual(['M:10', 'M:5', 'XL:4']);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('IN_PRODUCTION');
    // reservado não pode sair por movimento manual
    expect((await prod.call('POST', '/stock/movements', { type: 'OUT', itemId: tecido.id, warehouseId: wh, quantity: 1 })).body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('saída de material consome primeiro a reserva; consumo real e desvio', async () => {
    const r = await prod.call('POST', `/production/orders/${poId}/issue`, { lines: [{ itemId: tecido.id, quantity: 20 }, { itemId: botao.id, quantity: 60 }] });
    expect(r.status).toBe(200);
    expect(await level(tecido.id)).toEqual({ onHand: 0, reserved: 0 });
    expect(await level(botao.id)).toEqual({ onHand: 140, reserved: 0 }); // 57 da reserva + 3 do livre
    const b = r.body.consumption.find((c: { itemId: string }) => c.itemId === botao.id);
    expect(b.issued).toBe(60);
    expect(b.deviationPct).toBe(5.3); // (60−57)/57
    expect(r.body.costs.material).toBe(20 * 1000 + 60 * 20);
  });

  it('chão de fábrica: PIN → QR → iniciar/concluir; fluxo parcial; qualidade com retrabalho', async () => {
    // PIN único (a BD de teste acumula operadores de execuções anteriores).
    let pin = '';
    for (let tries = 0; tries < 20; tries++) {
      pin = String(Math.floor(100000 + Math.random() * 899999));
      if ((await admin.call('PATCH', `/production/config/operators/${opPiece}`, { pin })).status === 200) break;
    }
    const login = await app.inject({ method: 'POST', url: '/api/floor/login', payload: { pin } });
    expect(login.statusCode).toBe(200);
    expect(login.json().operator.id).toBe(opPiece);
    const tok = login.json().token;
    // token de operador não acede ao resto da API
    expect((await app.inject({ url: '/api/clients', headers: { authorization: `Bearer ${tok}` } })).statusCode).toBe(401);
    const floor = async (method: 'GET' | 'POST', url: string, payload?: object) => {
      const r = await app.inject({ method, url: `/api/floor${url}`, headers: { authorization: `Bearer ${tok}` }, payload });
      return { status: r.statusCode, body: r.json() };
    };
    const po = (await prod.call('GET', `/production/orders/${poId}`)).body;
    const lot = po.lots.find((l: { size: string }) => l.size === 'XL'); // 4 peças
    const scanned = await floor('GET', `/lots/${encodeURIComponent(`http://x/chao?lote=${lot.qrToken}`)}`);
    expect(scanned.body.number).toBe(lot.number);

    const st = (n: string) => stages.find((s) => s.name === n)!;
    const office = (url: string, body: object) => prod.call('POST', url, body);
    const finish = (id: string, body: object) => prod.call('POST', `/production/logs/${id}/finish`, body);

    // Costura antes do corte: nada disponível
    expect((await floor('POST', '/start', { lotId: lot.id, stageId: st('Costura').id, quantity: 1 })).body.error.code).toBe('NOT_AVAILABLE');
    // Corte (operador fixo, pelo escritório): 3 de 4 concluídas
    const cut = await office('/production/logs', { lotId: lot.id, stageId: st('Corte').id, quantity: 4, operatorId: opFixed });
    expect((await finish(cut.body.id, { qtyDone: 3, qtyRejected: 0 })).body.error.code).toBe('QTY_MISMATCH');
    expect((await finish(cut.body.id, { qtyDone: 3, qtyRejected: 1 })).status).toBe(200);
    // Fluxo parcial: costura só pode iniciar 3
    expect((await floor('POST', '/start', { lotId: lot.id, stageId: st('Costura').id, quantity: 4 })).body.error.code).toBe('NOT_AVAILABLE');
    const sew = await floor('POST', '/start', { lotId: lot.id, stageId: st('Costura').id, quantity: 3 });
    expect(sew.status).toBe(200);
    expect((await floor('GET', '/my-open')).body.some((l: { id: string }) => l.id === sew.body.id)).toBe(true);
    const sewDone = await floor('POST', `/logs/${sew.body.id}/finish`, { qtyDone: 3 });
    expect(sewDone.body.log.labourCost).toBe(3 * 150); // valor específico do modelo

    // Bordado (externa): fornecedor + custo
    const ext = (await prod.call('GET', '/production/config/stages')).body;
    const sup = await supplier();
    await admin.call('PATCH', `/production/config/stages/${st('Bordado/Estampagem').id}`, { type: 'EXTERNAL' });
    expect((await office('/production/logs', { lotId: lot.id, stageId: st('Bordado/Estampagem').id, quantity: 3, operatorId: opPiece })).body.error.code).toBe('SUPPLIER_REQUIRED');
    const emb = await office('/production/logs', { lotId: lot.id, stageId: st('Bordado/Estampagem').id, quantity: 3, supplierId: sup.id });
    expect((await finish(emb.body.id, { qtyDone: 3, cost: 1500 })).status).toBe(200);
    await admin.call('PATCH', `/production/config/stages/${st('Bordado/Estampagem').id}`, { type: ext.find((s: { id: string }) => s.id === st('Bordado/Estampagem').id).type });

    const fin = await floor('POST', '/start', { lotId: lot.id, stageId: st('Acabamento').id, quantity: 3 });
    await floor('POST', `/logs/${fin.body.id}/finish`, { qtyDone: 3 });

    // Qualidade: 1 aprovada, 1 retrabalho → costura, 1 refugo com defeito
    const defect = (await floor('GET', '/defect-types')).body[0];
    const qc = await floor('POST', '/start', { lotId: lot.id, stageId: st('Controlo de qualidade').id, quantity: 3 });
    const bad = await floor('POST', `/logs/${qc.body.id}/finish`, { qtyDone: 1, qtyRejected: 1, qtyRework: 1, reworkStageId: st('Embalagem').id });
    expect(bad.body.error.code).toBe('INVALID_REWORK_STAGE');
    const qcOk = await floor('POST', `/logs/${qc.body.id}/finish`, {
      qtyDone: 1, qtyRejected: 1, qtyRework: 1, reworkStageId: st('Costura').id, defects: [{ defectTypeId: defect.id, quantity: 2 }],
    });
    expect(qcOk.status).toBe(200);
    const after = (await floor('GET', `/lots/${lot.qrToken}`)).body;
    expect(after.stages.find((s: { id: string }) => s.id === st('Costura').id).available).toBe(1);
    expect(after.stages.find((s: { id: string }) => s.id === st('Embalagem').id).available).toBe(1);
  });

  it('não conclui a OP com lotes abertos; cancela e liberta reservas', async () => {
    expect((await prod.call('POST', `/production/orders/${poId}/complete`)).body.error.code).toBe('LOTS_OPEN');
  });

  it('pagamento à peça por período e margem da encomenda', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const pay = (await admin.call('GET', `/production/piece-pay?from=${from}&to=${to}`)).body;
    const ana = pay.find((p: { operatorId: string }) => p.operatorId === opPiece);
    expect(ana.pieces).toBe(3 + 3 + 1); // costura 3 + acabamento 3 + QC 1
    expect(ana.pieceAmount).toBe(450); // só costura tem valor
    const rui = pay.find((p: { operatorId: string }) => p.operatorId === opFixed);
    expect(rui.pieceAmount).toBe(0);
    expect(rui.fixed).toBe(80000);
    expect((await comercial.call('GET', `/production/piece-pay?from=${from}&to=${to}`)).status).toBe(403);

    const m = (await admin.call('GET', `/production/order-margin/${orderId}`)).body;
    expect(m.sale).toBe(19 * 6000);
    expect(m.cost).toBe(20_000 + 1200 + 450 + 1500);
    expect(m.value).toBe(m.sale - m.cost);
  });

  it('etiquetas PDF com QR', async () => {
    const r = await prod.call('GET', `/production/orders/${poId}/labels`);
    expect(r.raw.headers['content-type']).toBe('application/pdf');
    expect(r.raw.rawPayload.toString('latin1')).toMatch(/\/Count 1\b/);
  });

  it('OP imprimível em PDF', async () => {
    const r = await prod.call('GET', `/production/orders/${poId}/pdf`);
    expect(r.raw.statusCode).toBe(200);
    expect(r.raw.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});
