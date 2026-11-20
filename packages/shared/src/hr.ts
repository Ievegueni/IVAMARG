// Regras de RH puras: dias úteis, férias, cálculo de salário (INSS/IRT configuráveis).

export const EMPLOYEE_STATUS = { ACTIVE: 'Activo', SUSPENDED: 'Suspenso', TERMINATED: 'Cessado' } as const;
export const CONTRACT_TYPES = { EFFECTIVE: 'Efectivo (sem termo)', FIXED_TERM: 'A termo certo', SERVICE: 'Prestação de serviços' } as const;
export const ATTENDANCE_STATUS = { PRESENT: 'Presente', LATE: 'Atraso', ABSENT: 'Falta injustificada', JUSTIFIED: 'Falta justificada', VACATION: 'Férias', SICK: 'Doença', HOLIDAY: 'Feriado' } as const;
export type AttendanceStatus = keyof typeof ATTENDANCE_STATUS;
export const LEAVE_TYPES = { VACATION: 'Férias', SICK: 'Doença', JUSTIFIED: 'Falta justificada', OTHER: 'Outra' } as const;
export const LEAVE_STATUS = { PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Rejeitado', CANCELLED: 'Cancelado' } as const;
export const PAYROLL_STATUS = { DRAFT: 'Rascunho', APPROVED: 'Aprovada', PAID: 'Paga' } as const;

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
