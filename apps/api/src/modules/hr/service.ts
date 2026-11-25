import { attendanceFromPunches, businessDays, computePay, DEFAULT_SCHEDULE, salaryInstalment, type salaryPaymentSchema, type ListQuery, type PayrollRules, type WorkSchedule, attendanceSheetSchema, biometricImportSchema, employeeSchema, leaveSchema } from '@ivamarg/shared';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { nextNumber } from '../../lib/sequence';
import { getSetting } from '../../lib/settings';
import { putFile, signedUrl } from '../../lib/storage';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Limites do mês AAAA-MM em hora de Luanda (UTC+1, sem horário de verão). */
const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1, -1)), to: new Date(Date.UTC(y, m, 1, -1)), first: day(`${period}-01`), next: new Date(Date.UTC(y, m, 1)) };
};
const holidays = () => getSetting<string[]>('hr.holidays', []);

// ── Trabalhadores ──

type EmployeeData = z.output<typeof employeeSchema>;

export async function listEmployees(q: ListQuery & { status?: string; department?: string }) {
  const where = {
    deletedAt: null,
    ...(q.status && { status: q.status }),
    ...(q.department && { department: q.department }),
    ...(q.search && { OR: ['name', 'number', 'bi', 'nif', 'position'].map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' as const } })) }),
  };
  const [items, total] = await Promise.all([
    prisma.employee.findMany({ where, include: { operator: { select: { id: true, code: true, name: true } } }, ...pageArgs(q, ['name', 'number', 'hireDate', 'baseSalary'], { name: 'asc' }) }),
    prisma.employee.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function getEmployee(id: string) {
  const e = await prisma.employee.findFirst({ where: { id, deletedAt: null }, include: { operator: { select: { id: true, code: true, name: true } } } });
  if (!e) throw notFound('Trabalhador');
  const year = new Date().getUTCFullYear();
  const [leaves, payslips] = await Promise.all([
    prisma.leave.findMany({ where: { employeeId: id }, orderBy: { startDate: 'desc' }, take: 20 }),
    prisma.payslip.findMany({ where: { employeeId: id }, include: { run: { select: { id: true, period: true, status: true } } }, orderBy: { run: { period: 'desc' } }, take: 12 }),
  ]);
  return { ...e, leaves, payslips, vacation: await vacationBalance(id, year, e.vacationDays) };
}

async function checkBiometric(biometricId: string | null | undefined, employeeId?: string) {
  if (!biometricId) return;
  const taken = await prisma.employee.findFirst({ where: { biometricId, ...(employeeId && { id: { not: employeeId } }) } });
  if (taken) throw new AppError(409, 'BIOMETRIC_TAKEN', `O n.º biométrico ${biometricId} já está atribuído a ${taken.name}`);
}

async function checkOperator(operatorId: string | null, employeeId?: string) {
  if (!operatorId) return;
  const taken = await prisma.employee.findFirst({ where: { operatorId, deletedAt: null, ...(employeeId && { id: { not: employeeId } }) } });
  if (taken) throw new AppError(409, 'OPERATOR_TAKEN', `Este operador já está ligado a ${taken.name}`);
}

export async function createEmployee(ctx: Ctx, d: EmployeeData) {
  await checkOperator(d.operatorId);
  await checkBiometric(d.biometricId);
  return prisma.$transaction(async (tx) => {
    const e = await tx.employee.create({ data: { ...d, number: await nextNumber(tx, 'FUN'), createdById: ctx.userId } });
    await audit(ctx, { entity: 'Employee', entityId: e.id, action: 'create', after: e }, tx);
    return e;
  });
}

export async function updateEmployee(ctx: Ctx, id: string, d: Partial<EmployeeData>) {
  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Trabalhador');
  if (d.operatorId !== undefined) await checkOperator(d.operatorId, id);
  await checkBiometric(d.biometricId, id);
  const e = await prisma.employee.update({ where: { id }, data: d });
  await audit(ctx, { entity: 'Employee', entityId: id, action: 'update', before, after: e });
  return e;
}

export async function deleteEmployee(ctx: Ctx, id: string) {
  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Trabalhador');
  // Liberta o operador para poder ser ligado a outro trabalhador; o histórico fica.
  await prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), operatorId: null, biometricId: null, status: 'TERMINATED' } });
  await audit(ctx, { entity: 'Employee', entityId: id, action: 'delete', before });
}

// ── Assiduidade ──

export async function attendanceSheet(date: string) {
  const [employees, records] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true, number: true, name: true, position: true, department: true }, orderBy: { name: 'asc' } }),
    prisma.attendance.findMany({ where: { date: day(date) } }),
  ]);
  const byId = new Map(records.map((r) => [r.employeeId, r]));
  return { date, isHoliday: (await holidays()).includes(date), rows: employees.map((e) => ({ employee: e, record: byId.get(e.id) ?? null })) };
}

export async function saveAttendance(ctx: Ctx, d: z.output<typeof attendanceSheetSchema>) {
  const date = day(d.date);
  await prisma.$transaction(
    d.rows.map(({ employeeId, ...r }) =>
      prisma.attendance.upsert({
        where: { employeeId_date: { employeeId, date } },
        create: { employeeId, date, ...r, updatedById: ctx.userId },
        update: { ...r, updatedById: ctx.userId },
      }),
    ),
  );
  await audit(ctx, { entity: 'Attendance', action: 'save', after: { date: d.date, rows: d.rows.length } });
  return attendanceSheet(d.date);
}

/**
 * Importação do relógio biométrico. Substitui no período os registos Presente/Atraso/Falta dos trabalhadores
 * com n.º biométrico; justificações, férias, doença e feriados (manuais ou de pedidos) ficam intactos.
 */
export async function importBiometric(ctx: Ctx, d: z.output<typeof biometricImportSchema>) {
  const [employees, schedule, hol] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: { not: 'TERMINATED' }, biometricId: { not: null } }, select: { id: true, name: true, number: true, biometricId: true, hireDate: true } }),
    getSetting<WorkSchedule>('hr.schedule', DEFAULT_SCHEDULE),
    holidays(),
  ]);
  const range = { from: d.from, to: d.to };
  const { rows, unmatched } = attendanceFromPunches(d.punches, employees.map((e) => ({ id: e.id, biometricId: e.biometricId!, hireDate: iso(e.hireDate) })), range, schedule, hol);
  const protectedDays = new Set(
    (await prisma.attendance.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: day(d.from), lte: day(d.to) }, OR: [{ leaveId: { not: null } }, { status: { notIn: ['PRESENT', 'LATE', 'ABSENT'] } }] }, select: { employeeId: true, date: true } }))
      .map((a) => `${a.employeeId}|${iso(a.date)}`),
  );
  const toSave = rows.filter((r) => !protectedDays.has(`${r.employeeId}|${r.date}`));
  const summary = employees
    .map((e) => {
      const mine = toSave.filter((r) => r.employeeId === e.id);
      return { employee: { id: e.id, number: e.number, name: e.name, biometricId: e.biometricId }, present: mine.filter((r) => r.status === 'PRESENT').length, late: mine.filter((r) => r.status === 'LATE').length, absent: mine.filter((r) => r.status === 'ABSENT').length, incomplete: mine.filter((r) => r.incomplete).length, overtimeHours: mine.reduce((s, r) => s + r.overtimeHours, 0) };
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  const result = { from: d.from, to: d.to, punches: d.punches.length, records: toSave.length, kept: rows.length - toSave.length, employees: summary, unmatched };
  if (d.dryRun) return result;
  await prisma.$transaction([
    prisma.attendance.deleteMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: day(d.from), lte: day(d.to) }, leaveId: null, status: { in: ['PRESENT', 'LATE', 'ABSENT'] } } }),
    prisma.attendance.createMany({ data: toSave.map(({ incomplete: _i, ...r }) => ({ ...r, date: day(r.date), updatedById: ctx.userId })), skipDuplicates: true }),
  ]);
  await audit(ctx, { entity: 'Attendance', action: 'import_biometric', after: { from: d.from, to: d.to, punches: d.punches.length, records: toSave.length, unmatched: unmatched.map((u) => u.id) } });
  return result;
}

/** Resumo do mês por trabalhador: contagem por estado e horas extra. */
export async function attendanceMonth(period: string) {
  const { first, next } = monthRange(period);
  const [employees, records] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: { not: 'TERMINATED' } }, select: { id: true, number: true, name: true, department: true }, orderBy: { name: 'asc' } }),
    prisma.attendance.findMany({ where: { date: { gte: first, lt: next } } }),
  ]);
  return employees.map((e) => {
    const mine = records.filter((r) => r.employeeId === e.id);
    const counts: Record<string, number> = {};
    for (const r of mine) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { employee: e, counts, overtimeHours: mine.reduce((s, r) => s + r.overtimeHours, 0), days: mine.length };
  });
}

// ── Férias e ausências ──

export async function vacationBalance(employeeId: string, year: number, entitled?: number) {
  entitled ??= (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).vacationDays;
  const leaves = await prisma.leave.findMany({ where: { employeeId, type: 'VACATION', status: { in: ['APPROVED', 'PENDING'] }, startDate: { gte: day(`${year}-01-01`), lt: day(`${year + 1}-01-01`) } } });
  const used = leaves.filter((l) => l.status === 'APPROVED').reduce((s, l) => s + l.days, 0);
  const pending = leaves.filter((l) => l.status === 'PENDING').reduce((s, l) => s + l.days, 0);
  return { year, entitled, used, pending, available: entitled - used - pending };
}

export async function listLeaves(q: ListQuery & { status?: string; employeeId?: string }) {
  const where = { ...(q.status && { status: q.status }), ...(q.employeeId && { employeeId: q.employeeId }), ...(q.search && { employee: { name: { contains: q.search, mode: 'insensitive' as const } } }) };
  const [items, total] = await Promise.all([
    prisma.leave.findMany({ where, include: { employee: { select: { id: true, number: true, name: true } } }, ...pageArgs(q, ['startDate', 'createdAt'], { startDate: 'desc' }) }),
    prisma.leave.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function createLeave(ctx: Ctx, d: z.output<typeof leaveSchema>) {
  const emp = await prisma.employee.findFirst({ where: { id: d.employeeId, deletedAt: null } });
  if (!emp) throw notFound('Trabalhador');
  const days = businessDays(d.startDate, d.endDate, await holidays()).length;
  if (!days) throw new AppError(422, 'NO_WORKING_DAYS', 'O período não tem dias úteis');
  const overlap = await prisma.leave.findFirst({ where: { employeeId: d.employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: day(d.endDate) }, endDate: { gte: day(d.startDate) } } });
  if (overlap) throw new AppError(409, 'LEAVE_OVERLAP', 'Já existe um pedido neste período');
  if (d.type === 'VACATION') {
    const b = await vacationBalance(d.employeeId, Number(d.startDate.slice(0, 4)), emp.vacationDays);
    if (days > b.available) throw new AppError(422, 'VACATION_BALANCE', `Saldo de férias insuficiente: ${b.available} dia(s) disponíveis, pedidos ${days}`);
  }
  const l = await prisma.leave.create({ data: { ...d, startDate: day(d.startDate), endDate: day(d.endDate), days, createdById: ctx.userId } });
  await audit(ctx, { entity: 'Leave', entityId: l.id, action: 'create', after: l });
  return l;
}

const LEAVE_ATTENDANCE: Record<string, string> = { VACATION: 'VACATION', SICK: 'SICK', JUSTIFIED: 'JUSTIFIED', OTHER: 'JUSTIFIED' };

/** Aprovar marca a assiduidade dos dias úteis do período; rejeitar/cancelar só muda o estado. */
export async function decideLeave(ctx: Ctx, id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', comment: string | null) {
  const l = await prisma.leave.findUnique({ where: { id } });
  if (!l) throw notFound('Pedido');
  const allowed = status === 'CANCELLED' ? ['PENDING', 'APPROVED'] : ['PENDING'];
  if (!allowed.includes(l.status)) throw new AppError(409, 'INVALID_STATE', 'O pedido já foi decidido');
  const dates = businessDays(iso(l.startDate), iso(l.endDate), await holidays());
  return prisma.$transaction(async (tx) => {
    const after = await tx.leave.update({ where: { id }, data: { status, comment, decidedById: ctx.userId, decidedAt: new Date() } });
    if (status === 'APPROVED') {
      for (const d of dates) {
        const data = { status: LEAVE_ATTENDANCE[l.type], leaveId: id, updatedById: ctx.userId };
        await tx.attendance.upsert({ where: { employeeId_date: { employeeId: l.employeeId, date: day(d) } }, create: { employeeId: l.employeeId, date: day(d), ...data }, update: data });
      }
    } else if (l.status === 'APPROVED') {
      await tx.attendance.deleteMany({ where: { leaveId: id } });
    }
    await audit(ctx, { entity: 'Leave', entityId: id, action: status.toLowerCase(), before: l, after }, tx);
    return after;
  });
}

/** Documento justificativo (atestado, declaração…) anexado ao pedido; um novo envio substitui o anterior. */
export async function attachLeaveFile(ctx: Ctx, id: string, file: { buffer: Buffer; filename: string; mime: string }) {
  const l = await prisma.leave.findUnique({ where: { id } });
  if (!l) throw notFound('Pedido');
  const key = await putFile(file.buffer, 'hr', file.filename);
  const after = await prisma.leave.update({ where: { id }, data: { attachmentKey: key, attachmentName: file.filename, attachmentMime: file.mime } });
  await audit(ctx, { entity: 'Leave', entityId: id, action: 'attach', before: { attachmentName: l.attachmentName }, after: { attachmentName: file.filename, size: file.buffer.length } });
  return after;
}

export async function leaveFileUrl(ctx: Ctx, id: string) {
  const l = await prisma.leave.findUnique({ where: { id } });
  if (!l?.attachmentKey) throw notFound('Documento');
  await audit(ctx, { entity: 'Leave', entityId: id, action: 'view_attachment' });
  return { url: signedUrl(l.attachmentKey, 300), mime: l.attachmentMime, filename: l.attachmentName };
}

// ── Salários ──

const rules = () => getSetting<PayrollRules | null>('hr.payroll', null).then((r) => {
  if (!r) throw new AppError(422, 'PAYROLL_RULES', 'Regras de salário não configuradas (backoffice)');
  return r;
});

export const listRuns = () =>
  prisma.payrollRun.findMany({ orderBy: { period: 'desc' }, include: { payslips: { select: { gross: true, net: true, paid: true, inssEmployee: true, inssEmployer: true, irt: true } } } }).then((runs) =>
    runs.map(({ payslips, ...r }) => ({ ...r, count: payslips.length, ...sum(payslips) })),
  );

const sum = (ps: { gross: number; net: number; paid: number; inssEmployee: number; inssEmployer: number; irt: number }[]) => ({
  gross: ps.reduce((s, p) => s + p.gross, 0),
  net: ps.reduce((s, p) => s + p.net, 0),
  paid: ps.reduce((s, p) => s + p.paid, 0),
  inss: ps.reduce((s, p) => s + p.inssEmployee + p.inssEmployer, 0),
  irt: ps.reduce((s, p) => s + p.irt, 0),
  employerCost: ps.reduce((s, p) => s + p.gross + p.inssEmployer, 0),
});

export async function getRun(id: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id }, include: { payslips: { include: { employee: { select: { id: true, number: true, name: true, position: true, department: true, nif: true, inssNumber: true, iban: true, bank: true } }, payments: { orderBy: { createdAt: 'asc' } } }, orderBy: { employee: { name: 'asc' } } } } });
  if (!run) throw notFound('Folha de salários');
  return { ...run, totals: sum(run.payslips) };
}

/** Gera (ou recalcula, enquanto rascunho) a folha do mês a partir da ficha, assiduidade e produção à peça. */
export async function generateRun(ctx: Ctx, period: string) {
  const existing = await prisma.payrollRun.findUnique({ where: { period }, include: { payslips: true } });
  if (existing && existing.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'A folha deste mês já foi aprovada');
  const r = await rules();
  const { from, to, first, next } = monthRange(period);
  const [employees, attendance, logs] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: { not: 'TERMINATED' }, hireDate: { lt: next } } }),
    prisma.attendance.findMany({ where: { date: { gte: first, lt: next } } }),
    prisma.stageLog.findMany({ where: { finishedAt: { gte: from, lt: to }, operatorId: { not: null } }, select: { operatorId: true, labourCost: true } }),
  ]);
  const kept = new Map(existing?.payslips.map((p) => [p.employeeId, p]));
  return prisma.$transaction(async (tx) => {
    const run = existing
      ? await tx.payrollRun.update({ where: { id: existing.id }, data: { rules: r } })
      : await tx.payrollRun.create({ data: { period, rules: r, createdById: ctx.userId } });
    await tx.payslip.deleteMany({ where: { runId: run.id } });
    for (const e of employees) {
      const mine = attendance.filter((a) => a.employeeId === e.id);
      const prev = kept.get(e.id);
      const input = {
        baseSalary: e.baseSalary,
        mealAllowance: e.mealAllowance,
        transportAllowance: e.transportAllowance,
        otherAllowances: e.otherAllowances,
        overtimeHours: mine.reduce((s, a) => s + a.overtimeHours, 0),
        unjustifiedAbsences: mine.filter((a) => a.status === 'ABSENT').length,
        piecePay: e.operatorId ? logs.filter((l) => l.operatorId === e.operatorId).reduce((s, l) => s + l.labourCost, 0) : 0,
        bonus: prev?.bonus ?? 0,
        otherDeductions: prev?.otherDeductions ?? 0,
      };
      const p = computePay(input, r);
      const { unjustifiedAbsences, ...fields } = input;
      await tx.payslip.create({
        data: {
          runId: run.id, employeeId: e.id, notes: prev?.notes, ...fields, absences: unjustifiedAbsences,
          overtimePay: p.overtimePay, absenceDeduction: p.absenceDeduction, gross: p.gross, inssEmployee: p.inssEmployee, inssEmployer: p.inssEmployer, irt: p.irt, net: p.net,
        },
      });
    }
    await audit(ctx, { entity: 'PayrollRun', entityId: run.id, action: existing ? 'recalculate' : 'create', after: { period, employees: employees.length } }, tx);
    return run;
  }).then((run) => getRun(run.id));
}

export async function updatePayslip(ctx: Ctx, id: string, d: { bonus?: number; otherDeductions?: number; notes?: string | null }) {
  const before = await prisma.payslip.findUnique({ where: { id }, include: { run: true } });
  if (!before) throw notFound('Recibo');
  if (before.run.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'A folha já foi aprovada');
  const merged = { ...before, ...d };
  const p = computePay({ ...merged, unjustifiedAbsences: merged.absences }, before.run.rules as PayrollRules);
  const after = await prisma.payslip.update({ where: { id }, data: { ...d, gross: p.gross, inssEmployee: p.inssEmployee, inssEmployer: p.inssEmployer, irt: p.irt, net: p.net } });
  await audit(ctx, { entity: 'Payslip', entityId: id, action: 'update', before, after });
  return after;
}

/** Aprovar (rascunho → aprovada) ou reabrir (aprovada sem pagamentos → rascunho). Pagar = paySalaries. */
export async function setRunStatus(ctx: Ctx, id: string, status: 'APPROVED' | 'DRAFT') {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw notFound('Folha de salários');
  const from = { APPROVED: 'DRAFT', DRAFT: 'APPROVED' }[status];
  if (run.status !== from) throw new AppError(409, 'INVALID_STATE', 'Transição de estado inválida');
  const after = await prisma.payrollRun.update({
    where: { id },
    data: status === 'APPROVED' ? { status, approvedById: ctx.userId, approvedAt: new Date() } : { status, approvedById: null, approvedAt: null },
  });
  await audit(ctx, { entity: 'PayrollRun', entityId: id, action: status.toLowerCase(), before: run, after });
  return after;
}

// ── Pagamento dos salários (por trabalhador / departamento, total ou parcial) ──

/** Estado da folha a partir dos recibos: todos pagos → paga; algum pagamento → parcialmente paga. */
async function syncRunStatus(tx: Prisma.TransactionClient, runId: string) {
  const slips = await tx.payslip.findMany({ where: { runId }, select: { net: true, paid: true } });
  const status = slips.every((s) => s.paid >= s.net) ? 'PAID' : slips.some((s) => s.paid > 0) ? 'PARTIAL' : 'APPROVED';
  await tx.payrollRun.update({ where: { id: runId }, data: { status, paidAt: status === 'PAID' ? new Date() : null } });
  return status;
}

/** Paga os recibos seleccionados (% do líquido ou valor fixo) e lança cada pagamento como despesa "Salários". */
export async function paySalaries(ctx: Ctx, runId: string, d: z.output<typeof salaryPaymentSchema>) {
  if (d.amount !== undefined && d.payslipIds.length > 1) throw new AppError(422, 'AMOUNT_SINGLE', 'Valor fixo só para um trabalhador; para vários use a percentagem');
  return prisma.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw notFound('Folha de salários');
    if (!['APPROVED', 'PARTIAL'].includes(run.status)) throw new AppError(409, 'INVALID_STATE', 'Só folhas aprovadas podem ser pagas');
    await tx.$queryRaw`SELECT id FROM "Payslip" WHERE id IN (${Prisma.join(d.payslipIds)}) FOR UPDATE`;
    const slips = await tx.payslip.findMany({ where: { id: { in: d.payslipIds }, runId }, include: { employee: { select: { name: true } } } });
    const cat = await tx.entryCategory.upsert({ where: { name_type: { name: 'Salários', type: 'EXPENSE' } }, create: { name: 'Salários', type: 'EXPENSE' }, update: {} });
    let total = 0;
    let count = 0;
    for (const s of slips) {
      const amount = salaryInstalment(s.net, s.paid, d.percent, d.amount);
      if (!amount) continue;
      const p = await tx.salaryPayment.create({ data: { payslipId: s.id, amount, method: d.method, paidAt: d.paidAt, reference: d.reference, userId: ctx.userId } });
      await tx.payslip.update({ where: { id: s.id }, data: { paid: s.paid + amount } });
      await tx.financialEntry.create({ data: { type: 'EXPENSE', categoryId: cat.id, amount, date: d.paidAt, description: `Salário ${run.period} - ${s.employee.name}`, salaryPaymentId: p.id, createdById: ctx.userId } });
      total += amount;
      count++;
    }
    if (!count) throw new AppError(422, 'NOTHING_TO_PAY', 'Os recibos seleccionados já estão pagos');
    const status = await syncRunStatus(tx, runId);
    await audit(ctx, { entity: 'PayrollRun', entityId: runId, action: 'pay', after: { payslips: count, total, percent: d.percent, amount: d.amount, status } }, tx);
    return { count, total, status };
  });
}

/** Anular um pagamento (erro de registo): repõe o valor em falta e remove a despesa. */
export async function cancelSalaryPayment(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.salaryPayment.findUnique({ where: { id }, include: { payslip: true } });
    if (!p || p.cancelledAt) throw notFound('Pagamento');
    await tx.salaryPayment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await tx.payslip.update({ where: { id: p.payslipId }, data: { paid: { decrement: p.amount } } });
    await tx.financialEntry.updateMany({ where: { salaryPaymentId: id }, data: { deletedAt: new Date() } });
    await syncRunStatus(tx, p.payslip.runId);
    await audit(ctx, { entity: 'SalaryPayment', entityId: id, action: 'cancel', before: p }, tx);
    return { ok: true };
  });
}
