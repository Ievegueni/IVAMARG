import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let admin: Api, gestor: Api, comercial: Api, comercial2: Api;
const THRESHOLD = 5_000_000;
// Dados únicos por execução (a BD de teste não é limpa).
const uniq = (prefix: string, len: number) => prefix + String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0');
const PHONE_A = uniq('92', 7);
const PHONE_B = uniq('93', 7);

beforeAll(async () => {
  app = await setupApp();
  await prisma.setting.update({ where: { key: 'proposals.approvalThreshold' }, data: { value: THRESHOLD } });
  admin = await userClient(app, 'Administrador');
  gestor = await userClient(app, 'Gestor');
  comercial = await userClient(app, 'Comercial');
  comercial2 = await userClient(app, 'Comercial');
});
afterAll(async () => {
  await prisma.setting.update({ where: { key: 'users.maxActive' }, data: { value: 6 } });
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

const newClient = async (api: Api, extra: object = {}) => {
  const r = await api.call('POST', '/clients', { name: `Cliente ${Math.random().toString(36).slice(2, 7)}`, ...extra });
  expect(r.status).toBe(200);
  return r.body;
};
const newProposal = async (api: Api, clientId: string, kind: Parameters<typeof line>[0], unitPrice: number, extra: object = {}) => {
  const bl = await line(kind);
  const r = await api.call('POST', '/proposals', {
    title: `Proposta ${kind}`,
    clientId,
    businessLineId: bl.id,
    items: [{ description: 'Camisa polo', quantity: 10, unitPrice }],
    ...extra,
  });
  expect(r.status).toBe(200);
  return r.body;
};

describe('clientes', () => {
  it('bloqueia NIF duplicado e detecta telefone/email repetidos', async () => {
    const nif = uniq('5', 9);
    await newClient(comercial, { nif, phones: [PHONE_A], email: `dup-${run}@x.ao` });
    const dupNif = await comercial.call('POST', '/clients', { name: 'Outro', nif });
    expect(dupNif.status).toBe(409);
    expect(dupNif.body.error.code).toBe('DUPLICATE_NIF');
    const check = await admin.call('GET', `/clients/check-duplicates?phone=${encodeURIComponent('+244' + PHONE_A)}&email=dup-${run}@x.ao`);
    expect(check.body[0].matches).toEqual(['email', 'telefone']);
  });

  it('comercial só vê a sua carteira; gestor vê tudo', async () => {
    const mine = await newClient(comercial);
    expect(mine.ownerId).toBe(comercial.user.id);
    expect((await comercial2.call('GET', `/clients/${mine.id}`)).status).toBe(403);
    const list2 = await comercial2.call('GET', `/clients?search=${encodeURIComponent(mine.name)}`);
    expect(list2.body.total).toBe(0);
    expect((await gestor.call('GET', `/clients/${mine.id}`)).status).toBe(200);
  });

  it('importação: pré-visualização sem gravar, depois cria só linhas válidas', async () => {
    const rows = [
      { Nome: `Import A ${run}`, NIF: uniq('7', 9), Telefone: PHONE_B },
      { Nome: 'X' }, // nome curto → erro
      { Nome: `Import B ${run}`, Telefone: PHONE_B }, // telefone repetido no ficheiro
    ];
    const preview = await admin.call('POST', '/clients/import', { rows, dryRun: true });
    expect(preview.body.summary).toEqual({ total: 3, ok: 1, duplicate: 1, error: 1 });
    expect(await prisma.client.count({ where: { name: `Import A ${run}` } })).toBe(0);
    const done = await admin.call('POST', '/clients/import', { rows, dryRun: false });
    expect(done.body.created).toBe(1);
    expect(await prisma.client.count({ where: { name: `Import A ${run}` } })).toBe(1);
  });
});

describe('pipeline', () => {
  it('"Perdido" exige motivo', async () => {
    const c = await newClient(comercial);
    const bl = await line('UNIFORMS');
    const opp = (await comercial.call('POST', '/opportunities', { title: 'Fardas escola', clientId: c.id, businessLineId: bl.id, value: 100000 })).body;
    expect(opp.stage.name).toBe('Novo');
    const lost = bl.pipelineStages.find((s) => s.isLost)!;
    expect((await comercial.call('POST', `/opportunities/${opp.id}/move`, { stageId: lost.id })).body.error.code).toBe('LOST_REASON_REQUIRED');
    const ok = await comercial.call('POST', `/opportunities/${opp.id}/move`, { stageId: lost.id, lostReason: 'Preço' });
    expect(ok.body.lostReason).toBe('Preço');
    expect(ok.body.closedAt).not.toBeNull();
  });
});

describe('propostas - aprovação', () => {
  it('abaixo do limite: envia sem aprovação', async () => {
    const c = await newClient(comercial);
    const p = await newProposal(comercial, c.id, 'UNIFORMS', 10_000); // 100.000 Kz
    const sent = await comercial.call('POST', `/proposals/${p.id}/send`);
    expect(sent.body.status).toBe('SENT');
  });

  it('total ≥ limite: não envia sem aprovação; comercial não aprova; gestor aprova', async () => {
    const c = await newClient(comercial);
    const p = await newProposal(comercial, c.id, 'UNIFORMS', THRESHOLD / 10); // exactamente o limite
    expect(p.total).toBe(THRESHOLD);
    expect((await comercial.call('POST', `/proposals/${p.id}/send`)).body.error.code).toBe('APPROVAL_REQUIRED');

    const sub = await comercial.call('POST', `/proposals/${p.id}/submit`);
    expect(sub.body.status).toBe('PENDING_APPROVAL');
    // aprovadores notificados (gestor sim, comercial não)
    expect(await prisma.notification.count({ where: { userId: gestor.user.id, link: `/propostas/${p.id}` } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: comercial.user.id, link: `/propostas/${p.id}` } })).toBe(0);

    expect((await comercial.call('POST', `/proposals/${p.id}/approve`)).status).toBe(403);
    // gestor vê a proposta (fora da carteira dele) para aprovar
    expect((await gestor.call('GET', `/proposals/${p.id}`)).status).toBe(200);
    const ok = await gestor.call('POST', `/proposals/${p.id}/approve`, { comment: 'OK' });
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.versions[0].approvals[0].approver.id).toBe(gestor.user.id);
    expect((await comercial.call('POST', `/proposals/${p.id}/send`)).body.status).toBe('SENT');
  });

  it('rejeição exige motivo e permite editar e voltar a submeter', async () => {
    const c = await newClient(comercial);
    const p = await newProposal(comercial, c.id, 'UNIFORMS', THRESHOLD);
    await comercial.call('POST', `/proposals/${p.id}/submit`);
    expect((await gestor.call('POST', `/proposals/${p.id}/reject`, {})).body.error.code).toBe('COMMENT_REQUIRED');
    expect((await gestor.call('POST', `/proposals/${p.id}/reject`, { comment: 'Desconto excessivo' })).body.status).toBe('REJECTED');
    const edited = await comercial.call('PUT', `/proposals/${p.id}/draft`, { items: [{ description: 'Polo', quantity: 1, unitPrice: 1000 }] });
    expect(edited.body.status).toBe('DRAFT');
    expect(edited.body.total).toBe(1000);
    expect((await comercial.call('POST', `/proposals/${p.id}/submit`)).body.status).toBe('APPROVED'); // agora abaixo do limite
  });

  it('versão enviada é imutável; nova versão copia as linhas', async () => {
    const c = await newClient(comercial);
    const p = await newProposal(comercial, c.id, 'UNIFORMS', 1000, { items: [{ description: 'A', quantity: 2, unitPrice: 1000, discountPct: 10 }] });
    await comercial.call('POST', `/proposals/${p.id}/send`);
    const edit = await comercial.call('PUT', `/proposals/${p.id}/draft`, { items: [{ description: 'B', quantity: 1, unitPrice: 1 }] });
    expect(edit.body.error.code).toBe('INVALID_STATUS');
    const v2 = await comercial.call('POST', `/proposals/${p.id}/new-version`);
    expect(v2.body.currentVersion).toBe(2);
    expect(v2.body.status).toBe('DRAFT');
    const [latest, first] = v2.body.versions;
    expect(latest.items[0].description).toBe('A');
    expect(latest.total).toBe(1800);
    expect(first.sentAt).not.toBeNull();
    // PDF de qualquer versão
    const pdf = await comercial.call('GET', `/proposals/${p.id}/pdf?version=1`);
    expect(pdf.raw.headers['content-type']).toBe('application/pdf');
    expect(pdf.raw.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.raw.rawPayload.toString('latin1')).toMatch(/\/Count 1\b/); // rodapé não pode abrir página extra
  });
});

describe('propostas - aceitação e conversão', () => {
  it('uniformes → encomenda com as linhas; oportunidade passa a ganha', async () => {
    const c = await newClient(comercial);
    const bl = await line('UNIFORMS');
    const opp = (await comercial.call('POST', '/opportunities', { title: 'Fardas', clientId: c.id, businessLineId: bl.id })).body;
    const p = await newProposal(comercial, c.id, 'UNIFORMS', 0, {
      opportunityId: opp.id,
      items: [
        { description: 'Polo', quantity: 3, unitPrice: 1000, discountPct: 10 },
        { description: 'Calça', quantity: 2, unitPrice: 5000 },
      ],
    });
    expect((await comercial.call('POST', `/proposals/${p.id}/accept`)).body.error.code).toBe('INVALID_STATUS'); // ainda não enviada
    await comercial.call('POST', `/proposals/${p.id}/send`);
    const acc = await comercial.call('POST', `/proposals/${p.id}/accept`);
    expect(acc.body.status).toBe('ACCEPTED');
    expect(acc.body.order.number).toMatch(/^ENC-\d{4}-\d{4}$/);

    const order = await prisma.order.findUniqueOrThrow({ where: { proposalId: p.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    expect(order.clientId).toBe(c.id);
    expect(order.status).toBe('DRAFT');
    expect(order.lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([['Polo', 3, 900], ['Calça', 2, 5000]]);
    expect(order.total).toBe(p.total);

    const oppAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id }, include: { stage: true } });
    expect(oppAfter.stage.isWon).toBe(true);
    expect(await prisma.timelineEvent.count({ where: { clientId: c.id, entity: 'Order' } })).toBe(1);
  });

  it.each([
    ['CONSTRUCTION', 'project', /^OBR-/],
    ['BOREHOLE', 'borehole', /^FUR-/],
    ['CLEANING', 'contract', /^CTR-/],
  ] as const)('%s → %s', async (kind, rel, pattern) => {
    const c = await newClient(comercial);
    const p = await newProposal(comercial, c.id, kind, 10_000);
    await comercial.call('POST', `/proposals/${p.id}/send`);
    const acc = await comercial.call('POST', `/proposals/${p.id}/accept`);
    expect(acc.body[rel].number).toMatch(pattern);
    expect(acc.body.order).toBeNull();
  });
});

describe('encomendas', () => {
  it('quantidade = soma da grelha de tamanhos', async () => {
    const c = await newClient(admin);
    const r = await admin.call('POST', '/orders', {
      clientId: c.id,
      lines: [{ description: 'Bata', sizeGrid: { S: 10, M: 25, L: 5 }, unitPrice: 2000 }],
    });
    expect(r.body.lines[0].quantity).toBe(40);
    expect(r.body.total).toBe(80000);
  });
});
