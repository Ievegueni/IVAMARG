import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues } from '../../jobs/queues';
import { documentsExpiryAlert } from '../../jobs/alerts';
import { queue } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';
import { birthdayGreetings, payDateOf, salaryAlert } from './alerts';

let app: FastifyInstance;
type Api = Awaited<ReturnType<typeof userClient>>;
let gestor: Api, financeiro: Api, comercial: Api;
// Mês único por execução (a folha é única por mês e a BD de teste não é limpa).
const year = 2100 + Math.floor(Math.random() * 7000);
const period = `${year}-03`;

beforeAll(async () => {
  app = await setupApp();
  gestor = await userClient(app, 'Gestor');
  financeiro = await userClient(app, 'Financeiro');
  comercial = await userClient(app, 'Comercial');
});
afterAll(async () => {
  await app.close();
  await closeQueues();
  await prisma.$disconnect();
});

describe('RH', () => {
  it('permissões: comercial não vê; financeiro vê mas não cria', async () => {
    expect((await comercial.call('GET', '/hr/employees')).status).toBe(403);
    expect((await financeiro.call('GET', '/hr/employees')).status).toBe(200);
    expect((await financeiro.call('POST', '/hr/employees', { name: 'X', position: 'Y', hireDate: '2026-01-01' })).status).toBe(403);
  });

  it('trabalhador → assiduidade → férias (saldo) → folha de salários e recibo PDF', async () => {
    const e = await gestor.call('POST', '/hr/employees', {
      name: `Costureira ${run}`, position: 'Costureira', department: 'Fábrica', hireDate: '2026-01-05',
      baseSalary: 88_000, mealAllowance: 20_000, vacationDays: 22,
    });
    expect(e.status).toBe(200);
    expect(e.body.number).toMatch(/^FUN-\d{4}-\d{4}$/);
    const id = e.body.id;

    // Assiduidade: 1 falta injustificada + 4 h extra no mês.
    await gestor.call('PUT', '/hr/attendance', { date: `${period}-02`, rows: [{ employeeId: id, status: 'ABSENT' }] });
    const sheet = await gestor.call('PUT', '/hr/attendance', { date: `${period}-03`, rows: [{ employeeId: id, status: 'PRESENT', checkIn: '08:00', checkOut: '21:00', overtimeHours: 4 }] });
    expect(sheet.body.rows.find((r: { employee: { id: string } }) => r.employee.id === id).record.overtimeHours).toBe(4);
    const month = (await gestor.call('GET', `/hr/attendance/month?period=${period}`)).body;
    expect(month.find((m: { employee: { id: string } }) => m.employee.id === id)).toMatchObject({ counts: { ABSENT: 1, PRESENT: 1 }, overtimeHours: 4 });

    // Férias: 2 semanas = 10 dias úteis; saldo; pedido acima do saldo é recusado.
    const l = await gestor.call('POST', '/hr/leaves', { employeeId: id, type: 'VACATION', startDate: `${year}-06-01`, endDate: `${year}-06-14` });
    expect(l.status).toBe(200);
    expect(l.body.days).toBe(10);
    expect((await gestor.call('POST', '/hr/leaves', { employeeId: id, type: 'VACATION', startDate: `${year}-06-08`, endDate: `${year}-06-14` })).body.error.code).toBe('LEAVE_OVERLAP');
    expect((await gestor.call('POST', '/hr/leaves', { employeeId: id, type: 'VACATION', startDate: `${year}-07-01`, endDate: `${year}-07-31` })).body.error.code).toBe('VACATION_BALANCE');
    expect((await gestor.call('POST', `/hr/leaves/${l.body.id}/decision`, { status: 'APPROVED' })).status).toBe(200);
    expect(await prisma.attendance.count({ where: { employeeId: id, leaveId: l.body.id, status: 'VACATION' } })).toBe(10);
    await gestor.call('POST', `/hr/leaves/${l.body.id}/decision`, { status: 'CANCELLED' });
    expect(await prisma.attendance.count({ where: { leaveId: l.body.id } })).toBe(0);

    // Folha: base 88.000 (diário 4.000, hora 500) + alimentação 20.000 (isenta) + extra 4 × 500 × 1,5 − falta 4.000.
    const r = await gestor.call('POST', '/hr/payroll', { period });
    expect(r.status).toBe(200);
    const slip = r.body.payslips.find((p: { employeeId: string }) => p.employeeId === id);
    expect(slip).toMatchObject({ overtimePay: 3000, absences: 1, absenceDeduction: 4000, gross: 107_000, inssEmployee: 2610, irt: 0, net: 104_390 });

    // Prémio editado em rascunho → recalcula; regenerar mantém o prémio.
    const upd = await gestor.call('PATCH', `/hr/payslips/${slip.id}`, { bonus: 50_000 });
    expect(upd.body.gross).toBe(157_000);
    const again = (await gestor.call('POST', '/hr/payroll', { period })).body.payslips.find((p: { employeeId: string }) => p.employeeId === id);
    expect(again.bonus).toBe(50_000);

    // Aprovar fecha a edição; financeiro (só ver/exportar) não aprova mas tira o PDF.
    expect((await financeiro.call('POST', `/hr/payroll/${r.body.id}/status`, { status: 'APPROVED' })).status).toBe(403);
    expect((await gestor.call('POST', `/hr/payroll/${r.body.id}/status`, { status: 'APPROVED' })).status).toBe(200);
    expect((await gestor.call('PATCH', `/hr/payslips/${again.id}`, { bonus: 1 })).body.error.code).toBe('INVALID_STATE');
    const pdf = (await financeiro.call('GET', `/hr/payroll/${r.body.id}/pdf?employeeId=${id}`)).raw;
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('importa o biométrico: calcula presenças, atrasos, faltas; respeita justificações; anexa documento', async () => {
    const bio = String(90_000 + Math.floor(Math.random() * 9_000_000));
    const e = (await gestor.call('POST', '/hr/employees', { name: `Operador bio ${run}`, position: 'Cortador', hireDate: '2026-01-01', biometricId: bio })).body;
    expect((await gestor.call('POST', '/hr/employees', { name: `Outro ${run}`, position: 'Ajudante', hireDate: '2026-01-01', biometricId: bio })).body.error.code).toBe('BIOMETRIC_TAKEN');
    // Uma semana de seg. a sex.: seg. atrasado, ter.-qua. sem marcação (qua. justificada), qui.-sex. normais.
    const mon = new Date(Date.UTC(year, 8, 1));
    while (mon.getUTCDay() !== 1) mon.setUTCDate(mon.getUTCDate() + 1);
    const d = (i: number) => new Date(mon.getTime() + i * 86400000).toISOString().slice(0, 10);
    const leave = (await gestor.call('POST', '/hr/leaves', { employeeId: e.id, type: 'JUSTIFIED', startDate: d(2), endDate: d(2) })).body;
    await gestor.call('POST', `/hr/leaves/${leave.id}/decision`, { status: 'APPROVED' });
    const punches = [
      { id: bio, name: 'X', date: d(0), time: '08:40' }, { id: bio, name: 'X', date: d(0), time: '17:05' },
      { id: bio, name: 'X', date: d(3), time: '07:55' }, { id: bio, name: 'X', date: d(3), time: '19:00' },
      { id: bio, name: 'X', date: d(4), time: '08:00' }, { id: bio, name: 'X', date: d(4), time: '17:00' },
      { id: 'desconhecido', name: 'Fulano', date: d(0), time: '08:00' },
    ];
    const body = { punches, from: d(0), to: d(4) };
    const preview = (await gestor.call('POST', '/hr/attendance/import', body)).body;
    expect(preview.employees.find((x: { employee: { id: string } }) => x.employee.id === e.id)).toMatchObject({ present: 2, late: 1, absent: 1, overtimeHours: 2 });
    expect(preview.unmatched).toEqual([{ id: 'desconhecido', name: 'Fulano', punches: 1 }]);
    expect(await prisma.attendance.count({ where: { employeeId: e.id, leaveId: null } })).toBe(0); // pré-visualização não grava
    expect((await financeiro.call('POST', '/hr/attendance/import', { ...body, dryRun: false })).status).toBe(403);
    await gestor.call('POST', '/hr/attendance/import', { ...body, dryRun: false });
    await gestor.call('POST', '/hr/attendance/import', { ...body, dryRun: false }); // reimportar não duplica
    const rows = await prisma.attendance.findMany({ where: { employeeId: e.id }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['LATE', 'ABSENT', 'JUSTIFIED', 'PRESENT', 'PRESENT']);
    expect(rows[3]).toMatchObject({ checkIn: '07:55', checkOut: '19:00', overtimeHours: 2 });

    // Documento justificativo no pedido.
    const b = '----ivamarg';
    const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="atestado.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), Buffer.from('%PDF-1.4 atestado'), Buffer.from(`\r\n--${b}--\r\n`)]);
    const up = await app.inject({ method: 'POST', url: `/api/hr/leaves/${leave.id}/attachment`, headers: { authorization: `Bearer ${app.jwt.sign({ sub: gestor.user.id })}`, 'content-type': `multipart/form-data; boundary=${b}` }, payload });
    expect(up.json().attachmentName).toBe('atestado.pdf');
    const link = (await financeiro.call('GET', `/hr/leaves/${leave.id}/attachment`)).body;
    expect((await app.inject({ method: 'GET', url: link.url })).body).toBe('%PDF-1.4 atestado');
  });

  it('salários pagos por departamento e em parcelas; despesa automática; alertas de atraso', async () => {
    const p2 = `${year}-04`;
    const dept = `Costura ${run}`;
    const mk = (name: string, department: string) => gestor.call('POST', '/hr/employees', { name: `${name} ${run}`, position: 'Costureira', department, hireDate: '2026-01-05', baseSalary: 100_000 }).then((r) => r.body.id as string);
    const [a, b] = [await mk('Ana', dept), await mk('Bia', `Corte ${run}`)];
    const r = (await gestor.call('POST', '/hr/payroll', { period: p2 })).body;
    const slip = (id: string) => r.payslips.find((p: { employeeId: string }) => p.employeeId === id);
    const [sa, sb] = [slip(a), slip(b)];
    expect((await gestor.call('POST', `/hr/payroll/${r.id}/payments`, { payslipIds: [sa.id], method: 'TRANSFER', paidAt: `${p2}-25` })).body.error.code).toBe('INVALID_STATE'); // rascunho
    await gestor.call('POST', `/hr/payroll/${r.id}/status`, { status: 'APPROVED' });

    // Alerta 3 dias antes do dia de pagamento (25), com o valor em falta.
    expect(payDateOf(p2, { day: 31, nextMonth: false }).toISOString().slice(0, 10)).toBe(`${p2}-30`);
    await salaryAlert(new Date(`${p2}-22T00:00:00Z`));
    expect(await prisma.notification.count({ where: { userId: gestor.user.id, title: { contains: `Salários de ${p2}: pagamento até` } } })).toBe(1);

    // Pouca liquidez: departamento "Costura" recebe 50%.
    const pay1 = await gestor.call('POST', `/hr/payroll/${r.id}/payments`, { payslipIds: [sa.id], percent: 50, method: 'TRANSFER', paidAt: `${p2}-25` });
    expect(pay1.body).toMatchObject({ count: 1, total: Math.round(sa.net / 2), status: 'PARTIAL' });
    expect((await gestor.call('POST', `/hr/payroll/${r.id}/status`, { status: 'DRAFT' })).body.error.code).toBe('INVALID_STATE'); // já há pagamentos
    expect((await gestor.call('POST', `/hr/payroll/${r.id}/payments`, { payslipIds: [sa.id, sb.id], amount: 1000, method: 'CASH', paidAt: `${p2}-25` })).body.error.code).toBe('AMOUNT_SINGLE');
    const entries = await prisma.financialEntry.findMany({ where: { description: `Salário ${p2} - Ana ${run}`, deletedAt: null }, include: { category: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'EXPENSE', amount: Math.round(sa.net / 2), category: { name: 'Salários' } });

    // Alerta semanal de atraso (dia 25 + 7) enquanto houver valor em falta.
    await salaryAlert(new Date(`${p2}-25T00:00:00Z`));
    await salaryAlert(new Date(`${p2}-26T00:00:00Z`)); // fora do calendário: não avisa
    await salaryAlert(new Date(Date.UTC(year, 4, 2)));
    expect(await prisma.notification.count({ where: { userId: gestor.user.id, title: { contains: `Salários de ${p2}` } } })).toBe(3);

    // Anular repõe; depois paga-se o resto a todos.
    const run2 = (await gestor.call('GET', `/hr/payroll/${r.id}`)).body;
    const paymentId = run2.payslips.find((p: { id: string }) => p.id === sa.id).payments[0].id;
    await gestor.call('POST', `/hr/salary-payments/${paymentId}/cancel`);
    expect((await gestor.call('GET', `/hr/payroll/${r.id}`)).body.status).toBe('APPROVED');
    const all = (await gestor.call('GET', `/hr/payroll/${r.id}`)).body.payslips.map((p: { id: string }) => p.id);
    expect((await gestor.call('POST', `/hr/payroll/${r.id}/payments`, { payslipIds: all, method: 'TRANSFER', paidAt: `${p2}-28` })).body.status).toBe('PAID');
    expect((await financeiro.call('POST', `/hr/payroll/${r.id}/payments`, { payslipIds: all, method: 'TRANSFER', paidAt: `${p2}-28` })).status).toBe(403);
  });

  it('aniversário e documento a expirar: mensagem ao trabalhador (email quando o SMS está desligado)', async () => {
    const today = new Date(Date.UTC(year, 6, 14));
    const email = `aniv${run}@teste.ao`;
    const e = (await gestor.call('POST', '/hr/employees', { name: `Carla Aniv ${run}`, position: 'Motorista', hireDate: '2026-01-05', birthDate: '1990-07-14', email })).body;
    await prisma.featureFlag.updateMany({ where: { key: 'sms' }, data: { enabled: false } });
    const outbox = async () => (await queue('outbound').getJobs(['waiting', 'delayed', 'completed', 'failed'])).filter((j) => j.data.to === email);
    const r = await birthdayGreetings(today);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect((await outbox()).some((j) => j.data.html.includes('Parabéns, Carla!'))).toBe(true);
    expect(await prisma.notification.count({ where: { userId: gestor.user.id, title: { contains: `Carla Aniv ${run}` } } })).toBe(1);

    // Carta de condução ligada ao trabalhador, a expirar em 15 dias.
    const cat = await prisma.documentCategory.findFirstOrThrow({ where: { active: true, roleIds: { isEmpty: true } } });
    const doc = await prisma.document.create({
      data: { title: `Carta de condução ${run}`, categoryId: cat.id, expiresAt: new Date(today.getTime() + 15 * 86400000), links: { create: { entity: 'Employee', entityId: e.id } }, versions: { create: { version: 1, storageKey: 'x', filename: 'x.pdf', mime: 'application/pdf', size: 1 } } },
    });
    await documentsExpiryAlert(new Date(today.getTime() + 8 * 3600_000));
    expect((await outbox()).some((j) => j.data.html.includes(`Carta de condução ${run}`) && j.data.html.includes('expira em 15 dia(s)'))).toBe(true);
    await prisma.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
  });
});
