// Regras de RH puras: dias úteis, férias, cálculo de salário (INSS/IRT configuráveis).

export const EMPLOYEE_STATUS = { ACTIVE: 'Activo', SUSPENDED: 'Suspenso', TERMINATED: 'Cessado' } as const;
export const CONTRACT_TYPES = { EFFECTIVE: 'Efectivo (sem termo)', FIXED_TERM: 'A termo certo', SERVICE: 'Prestação de serviços' } as const;
export const ATTENDANCE_STATUS = { PRESENT: 'Presente', LATE: 'Atraso', ABSENT: 'Falta injustificada', JUSTIFIED: 'Falta justificada', VACATION: 'Férias', SICK: 'Doença', HOLIDAY: 'Feriado' } as const;
export type AttendanceStatus = keyof typeof ATTENDANCE_STATUS;
export const LEAVE_TYPES = { VACATION: 'Férias', SICK: 'Doença', JUSTIFIED: 'Falta justificada', OTHER: 'Outra' } as const;
export const LEAVE_STATUS = { PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Rejeitado', CANCELLED: 'Cancelado' } as const;
export const PAYROLL_STATUS = { DRAFT: 'Rascunho', APPROVED: 'Aprovada', PARTIAL: 'Parcialmente paga', PAID: 'Paga' } as const;

/** Dias úteis entre duas datas (AAAA-MM-DD, inclusivas), sem fins-de-semana nem feriados. */
export function businessDays(start: string, end: string, holidays: string[] = []) {
  const out: string[] = [];
  const h = new Set(holidays);
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !h.has(iso)) out.push(iso);
  }
  return out;
}

/** Escalão do IRT: sobre o rendimento colectável acima de `over` aplica-se `rate` %, mais `fixed`. */
export type IrtBracket = { upTo: number | null; fixed: number; rate: number; over: number };
export type PayrollRules = {
  workingDays: number; // dias por mês para salário diário
  hoursPerDay: number;
  overtimeRate: number; // % de acréscimo da hora extra (ex.: 50)
  inssEmployee: number; // % (ex.: 3)
  inssEmployer: number; // % (ex.: 8)
  allowanceExempt: number; // subsídio de alimentação/transporte isento de IRT/INSS até este valor (cada)
  irt: IrtBracket[];
};

export function irtOf(taxable: number, brackets: IrtBracket[]) {
  if (taxable <= 0) return 0;
  const b = brackets.find((x) => x.upTo === null || taxable <= x.upTo) ?? brackets[brackets.length - 1];
  return Math.round(b.fixed + Math.max(0, taxable - b.over) * (b.rate / 100));
}

export type PayInput = {
  baseSalary: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowances: number;
  overtimeHours: number;
  unjustifiedAbsences: number; // dias
  piecePay: number; // produção à peça no período
  bonus: number;
  otherDeductions: number;
};

/** Recibo de um trabalhador num mês. Valores em Kz inteiros. */
export function computePay(i: PayInput, r: PayrollRules) {
  const daily = i.baseSalary / r.workingDays;
  const hourly = daily / r.hoursPerDay;
  const overtimePay = Math.round(i.overtimeHours * hourly * (1 + r.overtimeRate / 100));
  const absenceDeduction = Math.round(Math.min(i.unjustifiedAbsences, r.workingDays) * daily);
  const allowances = i.mealAllowance + i.transportAllowance + i.otherAllowances;
  const gross = i.baseSalary + allowances + overtimePay + i.piecePay + i.bonus - absenceDeduction;
  // Parte isenta dos subsídios de alimentação e transporte (cada um até ao limite).
  const exempt = Math.min(i.mealAllowance, r.allowanceExempt) + Math.min(i.transportAllowance, r.allowanceExempt);
  const inssBase = Math.max(0, gross - exempt);
  const inssEmployee = Math.round(inssBase * (r.inssEmployee / 100));
  const inssEmployer = Math.round(inssBase * (r.inssEmployer / 100));
  const taxable = Math.max(0, gross - exempt - inssEmployee);
  const irt = irtOf(taxable, r.irt);
  const net = gross - inssEmployee - irt - i.otherDeductions;
  return { overtimePay, absenceDeduction, allowances, gross, inssBase, inssEmployee, inssEmployer, taxable, irt, net };
}

/** Valor a pagar agora num recibo: valor indicado ou % do líquido, nunca acima do que falta pagar. */
export const salaryInstalment = (net: number, paid: number, percent = 100, amount?: number) =>
  Math.max(0, Math.min(net - paid, amount ?? Math.round((net * percent) / 100)));

// ── Relógio biométrico ──

/** Marcação do relógio: n.º do trabalhador no relógio (sJobNo), nome, dia e hora. */
export type Punch = { id: string; name: string; date: string; time: string };
export type WorkSchedule = { start: string; end: string; toleranceMinutes: number; minOvertimeMinutes: number };
export const DEFAULT_SCHEDULE: WorkSchedule = { start: '08:00', end: '17:00', toleranceMinutes: 15, minOvertimeMinutes: 30 };

const clean = (v: unknown) => String(v ?? '').trim().replace(/^'+/, '').trim();
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = clean(v);
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD/MM/AAAA
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : null;
};
const timeOf = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === 'number' && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; } // fracção de dia (Excel)
  const m = clean(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}` : null;
};

/**
 * Lê a exportação do relógio (CSV ou Excel já convertido em linhas). Colunas reconhecidas pelo cabeçalho:
 * sJobNo/ID, sName/Nome, Date/Data, Time/Hora (ou uma coluna data+hora). Marcações sem n.º são ignoradas.
 */
export function parseBiometric(matrix: unknown[][]): Punch[] {
  const [header = [], ...rows] = matrix;
  const h = header.map((c) => clean(c).toLowerCase().replace(/[^a-z/]/g, ''));
  const col = (...names: string[]) => h.findIndex((c) => names.includes(c));
  const id = col('sjobno', 'jobno', 'id', 'no', 'acno', 'enno', 'userid', 'numero', 'n');
  const name = col('sname', 'name', 'nome');
  const date = col('date', 'data', 'datetime', 'date/time', 'checktime');
  const time = col('time', 'hora');
  if (id < 0 || date < 0) throw new Error('Ficheiro não reconhecido: faltam as colunas do n.º (sJobNo) e da data (Date)');
  const out: Punch[] = [];
  for (const r of rows) {
    const pid = clean(r[id]);
    const d = isoOf(r[date]);
    const t = timeOf(time >= 0 ? r[time] : String(r[date] ?? '').replace(/^\S+\s*/, '') || r[date]);
    if (!pid || pid.toUpperCase() === 'NULL' || !d || !t) continue;
    const n = name >= 0 ? clean(r[name]) : '';
    out.push({ id: pid, name: n.toUpperCase() === 'NULL' ? '' : n, date: d, time: t });
  }
  return out;
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** Marcações repetidas dentro deste intervalo contam como uma só (sem saída). */
const SAME_PUNCH_MINUTES = 30;

/**
 * Assiduidade calculada a partir das marcações: entrada = 1.ª do dia, saída = última.
 * Atraso se a entrada passar da tolerância; horas extra (em meias horas) depois do fim do horário,
 * ou todo o tempo em fins-de-semana/feriados. Dias úteis sem marcação = falta (desde a admissão).
 */
export function attendanceFromPunches(
  punches: Punch[],
  employees: { id: string; biometricId: string; hireDate: string }[],
  range: { from: string; to: string },
  schedule: WorkSchedule,
  holidays: string[] = [],
) {
  const byBio = new Map(employees.map((e) => [e.biometricId, e]));
  const days = new Map<string, number[]>(); // `${employeeId}|${date}` → minutos
  const unmatched = new Map<string, { id: string; name: string; punches: number }>();
  for (const p of punches) {
    if (p.date < range.from || p.date > range.to) continue;
    const e = byBio.get(p.id);
    if (!e) {
      const u = unmatched.get(p.id) ?? { id: p.id, name: '', punches: 0 };
      u.name ||= p.name;
      u.punches++;
      unmatched.set(p.id, u);
      continue;
    }
    const k = `${e.id}|${p.date}`;
    days.set(k, [...(days.get(k) ?? []), mins(p.time)]);
  }
  const workdays = new Set(businessDays(range.from, range.to, holidays));
  const rows: { employeeId: string; date: string; status: 'PRESENT' | 'LATE' | 'ABSENT'; checkIn: string | null; checkOut: string | null; overtimeHours: number; incomplete: boolean; notes: string }[] = [];
  for (const [k, ms] of days) {
    const [employeeId, date] = k.split('|');
    const first = Math.min(...ms), last = Math.max(...ms);
    let checkIn: number | null = first;
    let checkOut = last - first >= SAME_PUNCH_MINUTES ? last : null;
    // Marcação única depois do meio do horário: é a saída (faltou marcar a entrada).
    if (checkOut === null && first > (mins(schedule.start) + mins(schedule.end)) / 2) [checkIn, checkOut] = [null, first];
    const workday = workdays.has(date);
    const late = workday && checkIn !== null && checkIn > mins(schedule.start) + schedule.toleranceMinutes;
    const extra = checkOut === null ? 0 : workday ? checkOut - Math.max(mins(schedule.end), checkIn ?? 0) : checkIn === null ? 0 : checkOut - checkIn;
    const overtimeHours = extra >= schedule.minOvertimeMinutes ? Math.floor(extra / 30) / 2 : 0;
    const missing = checkIn === null ? ' - sem entrada' : checkOut === null ? ' - sem saída' : '';
    rows.push({
      employeeId, date, status: late ? 'LATE' : 'PRESENT', checkIn: checkIn === null ? null : hhmm(checkIn), checkOut: checkOut === null ? null : hhmm(checkOut),
      overtimeHours, incomplete: !!missing, notes: `Biométrico (${ms.length} marcações${missing})`,
    });
  }
  for (const e of employees)
    for (const date of workdays)
      if (date >= e.hireDate && !days.has(`${e.id}|${date}`)) rows.push({ employeeId: e.id, date, status: 'ABSENT', checkIn: null, checkOut: null, overtimeHours: 0, incomplete: false, notes: 'Biométrico: sem marcação' });
  return { rows, unmatched: [...unmatched.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)) };
}
