import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';
import { processInbound } from '../communication/service';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let admin: Api, prod: Api, comercial: Api;
let wh: string;

beforeAll(async () => {
  app = await setupApp();
  admin = await userClient(app, 'Administrador');
  prod = await userClient(app, 'Produção/Stock');
  comercial = await userClient(app, 'Comercial');
  wh = (await prisma.warehouse.findFirstOrThrow({ where: { code: 'PRINCIPAL' } })).id;
});
afterAll(async () => {
  await prisma.featureFlag.updateMany({ where: { key: { in: ['whatsapp.calls', 'meta.whatsapp'] } }, data: { enabled: false } });
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

describe('obras e furos', () => {
  it('proposta de obra em fases → obra com fases e orçamento; consumo de stock e despesas → orçado vs real', async () => {
    const client = (await admin.call('POST', '/clients', { name: `Cliente obra ${run}` })).body;
    const line = await prisma.businessLine.findFirstOrThrow({ where: { kind: 'CONSTRUCTION' } });
    const p = (await admin.call('POST', '/proposals', {
      title: `Muro ${run}`, clientId: client.id, businessLineId: line.id, mode: 'PHASES',
      items: [{ description: 'Fundações', quantity: 1, unitPrice: 300_000 }, { description: 'Alvenaria', quantity: 1, unitPrice: 200_000 }],
    })).body;
    await admin.call('POST', `/proposals/${p.id}/send`);
    const acc = (await admin.call('POST', `/proposals/${p.id}/accept`)).body;
    const proj = (await prod.call('GET', `/operations/projects/${acc.project.id}`)).body;
    expect(proj.budget).toBe(500_000);
    expect(proj.phases.map((f: { name: string; budget: number }) => [f.name, f.budget])).toEqual([['Fundações', 300_000], ['Alvenaria', 200_000]]);

    const item = (await prod.call('POST', '/stock/items', { code: `CIM-${run}`.toUpperCase(), name: 'Cimento 50kg', unit: 'saco', category: 'CONSTRUCTION' })).body;
    await prod.call('POST', '/stock/movements', { type: 'IN', itemId: item.id, warehouseId: wh, quantity: 100, unitCost: 4500 });
    const after = await prod.call('POST', `/operations/projects/${proj.id}/materials`, { warehouseId: wh, lines: [{ itemId: item.id, quantity: 40 }] });
    expect(after.body.costs.materialCost).toBe(180_000);
    const cat = await prisma.entryCategory.findFirstOrThrow({ where: { name: 'Subcontratação' } });
    await admin.call('POST', '/finance/entries', { type: 'EXPENSE', categoryId: cat.id, amount: 120_000, date: '2026-11-10', description: 'Pedreiros', entity: 'Project', entityId: proj.id });
    const final = (await prod.call('GET', `/operations/projects/${proj.id}`)).body;
    expect(final.costs).toMatchObject({ materialCost: 180_000, expenseCost: 120_000, total: 300_000 });
    expect(final.variance).toBe(200_000);
    expect(final.variancePct).toBe(60);
    // fase concluída fica a 100%
    const ph = (await prod.call('PATCH', `/operations/projects/${proj.id}/phases/${proj.phases[0].id}`, { status: 'DONE' })).body;
    expect(ph).toMatchObject({ progress: 100, status: 'DONE' });
    expect((await comercial.call('PATCH', `/operations/projects/${proj.id}`, { status: 'COMPLETED' })).status).toBe(403);
  });

  it('furo criado com as etapas configuradas e resultado (campos livres)', async () => {
    const client = (await admin.call('POST', '/clients', { name: `Fazenda ${run}` })).body;
    const b = (await prod.call('POST', '/operations/boreholes', { name: 'Furo Sector A', clientId: client.id, budget: 2_500_000, location: 'Caxito' })).body;
    const full = (await prod.call('GET', `/operations/boreholes/${b.id}`)).body;
    expect(full.phases.map((p: { name: string }) => p.name)).toContain('Perfuração');
    const r = (await prod.call('PATCH', `/operations/boreholes/${b.id}`, { result: { profundidade: '85 m', caudal: '6 m³/h' } })).body;
    expect(r.result).toEqual({ profundidade: '85 m', caudal: '6 m³/h' });
  });
});

describe('limpeza: visitas', () => {
  it('plano gera visitas (idempotente); execução regista na timeline', async () => {
    const client = (await admin.call('POST', '/clients', { name: `Condomínio ${run}` })).body;
    const c = (await admin.call('POST', '/contracts', { clientId: client.id, title: 'Limpeza semanal', startDate: '2026-11-01', value: 150_000, periodicity: 'MONTHLY' })).body;
    const r1 = (await prod.call('POST', `/operations/contracts/${c.id}/plan-visits`, { visitDays: [1, 3, 5], visitTime: '07:30', weeks: 2, visitTeam: 'Equipa A' })).body;
    expect(r1.created).toBeGreaterThanOrEqual(5);
    expect((await prod.call('POST', `/operations/contracts/${c.id}/plan-visits`, { visitDays: [1, 3, 5], visitTime: '07:30', weeks: 2 })).body.created).toBe(0);
    const v = await prisma.serviceVisit.findFirstOrThrow({ where: { contractId: c.id }, orderBy: { scheduledAt: 'asc' } });
    expect((v.checklist as unknown[]).length).toBeGreaterThan(0);
    const done = (await prod.call('PATCH', `/operations/visits/${v.id}`, { status: 'DONE', notes: 'Tudo ok' })).body;
    expect(done.executedAt).not.toBeNull();
    expect(await prisma.timelineEvent.count({ where: { clientId: client.id, entity: 'ServiceVisit' } })).toBe(1);
  });
});

describe('chamadas WhatsApp (sandbox)', () => {
  it('desligadas por defeito; recebida → atender → terminar → registo na timeline; efectuada só com consentimento', async () => {
    const phone = `92${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    expect((await admin.call('POST', '/communication/calls/simulate-incoming', { from: phone })).body.error.code).toBe('CALLS_DISABLED');
    await prisma.featureFlag.updateMany({ where: { key: { in: ['whatsapp.calls', 'meta.whatsapp'] } }, data: { enabled: true } });
    await prisma.setting.update({ where: { key: 'comms.sandbox' }, data: { value: true } });

    const call = (await admin.call('POST', '/communication/calls/simulate-incoming', { from: phone })).body;
    expect(call).toMatchObject({ direction: 'IN', status: 'RINGING' });
    expect((await admin.call('GET', '/communication/calls/active')).body.some((c: { id: string }) => c.id === call.id)).toBe(true);
    expect((await admin.call('POST', `/communication/calls/${call.id}/accept`, { sdp: 'v=0 answer' })).body.status).toBe('ACCEPTED');
    const ended = (await admin.call('POST', `/communication/calls/${call.id}/end`, { result: 'Pediu orçamento' })).body;
    expect(ended).toMatchObject({ status: 'ENDED', result: 'Pediu orçamento' });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: call.conversationId } });
    expect(await prisma.timelineEvent.count({ where: { clientId: conv.clientId!, entity: 'CallLog' } })).toBe(1);

    // terminada pelo cliente via webhook enquanto toca → "não atendida"
    await processInbound({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'calls', value: { calls: [{ id: `in-${run}`, from: `244${phone}`, event: 'connect', timestamp: String(Math.floor(Date.now() / 1000)), session: { sdp_type: 'offer', sdp: 'v=0' } }] } }] }] });
    await processInbound({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'calls', value: { calls: [{ id: `in-${run}`, from: `244${phone}`, event: 'terminate', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    expect((await prisma.callLog.findUniqueOrThrow({ where: { externalId: `in-${run}` } })).status).toBe('MISSED');

    expect((await admin.call('POST', `/communication/conversations/${conv.id}/call`, { sdp: 'v=0 offer' })).body.error.code).toBe('NO_CONSENT');
    await admin.call('POST', `/communication/conversations/${conv.id}/call-consent`, { granted: true });
    const out = (await admin.call('POST', `/communication/conversations/${conv.id}/call`, { sdp: 'v=0 offer' })).body;
    expect(out).toMatchObject({ direction: 'OUT', status: 'ACCEPTED' });
  });
});
