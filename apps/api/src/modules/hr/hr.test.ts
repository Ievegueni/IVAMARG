import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, setupApp, userClient } from '../../../test/helpers';
import { closeQueues } from '../../jobs/queues';
import { prisma } from '../../lib/prisma';

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
});
