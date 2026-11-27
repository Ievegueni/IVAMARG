import { describe, expect, it } from 'vitest';
import { attendanceFromPunches, businessDays, computePay, DEFAULT_SCHEDULE, irtOf, parseBiometric, salaryInstalment, type IrtBracket, type PayrollRules } from './hr';

// Tabela do IRT da AGT (Grupo A) — igual ao default do seed (`hr.payroll`).
const IRT: IrtBracket[] = [
  { upTo: 150_000, fixed: 0, rate: 0, over: 0 },
  { upTo: 200_000, fixed: 12_500, rate: 16, over: 150_000 },
  { upTo: 300_000, fixed: 31_250, rate: 18, over: 200_000 },
  { upTo: 500_000, fixed: 49_250, rate: 19, over: 300_000 },
  { upTo: 1_000_000, fixed: 87_250, rate: 20, over: 500_000 },
  { upTo: 1_500_000, fixed: 187_250, rate: 21, over: 1_000_000 },
  { upTo: 2_000_000, fixed: 292_250, rate: 22, over: 1_500_000 },
  { upTo: 2_500_000, fixed: 402_250, rate: 23, over: 2_000_000 },
  { upTo: 5_000_000, fixed: 517_250, rate: 24, over: 2_500_000 },
  { upTo: 10_000_000, fixed: 1_117_250, rate: 24.5, over: 5_000_000 },
  { upTo: null, fixed: 2_342_250, rate: 25, over: 10_000_000 },
];
const R: PayrollRules = { workingDays: 22, hoursPerDay: 8, overtimeRate: 50, inssEmployee: 3, inssEmployer: 8, allowanceExempt: 30_000, irt: IRT };
const base = { mealAllowance: 0, transportAllowance: 0, otherAllowances: 0, overtimeHours: 0, unjustifiedAbsences: 0, piecePay: 0, bonus: 0, otherDeductions: 0 };

describe('dias úteis', () => {
  it('sem fins-de-semana e feriados', () => {
    // 2026-11-09 (seg) a 2026-11-15 (dom); 11/11 feriado (Independência)
    expect(businessDays('2026-11-09', '2026-11-15', ['2026-11-11'])).toEqual(['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13']);
  });
});

describe('IRT', () => {
  it('isento até ao 1.º escalão; parcela fixa + taxa sobre o excesso', () => {
    expect(irtOf(150_000, IRT)).toBe(0);
    expect(irtOf(160_000, IRT)).toBe(12_500 + 1600); // + 16% de 10.000
    expect(irtOf(250_000, IRT)).toBe(31_250 + 9000); // + 18% de 50.000
    expect(irtOf(1_600_000, IRT)).toBe(292_250 + 22_000);
    expect(irtOf(12_000_000, IRT)).toBe(2_342_250 + 500_000);
    expect(irtOf(-5, IRT)).toBe(0);
  });
});

describe('recibo de vencimento', () => {
  it('base + subsídios: INSS 3%/8% sobre o não isento; IRT sobre colectável', () => {
    const p = computePay({ ...base, baseSalary: 200_000, mealAllowance: 40_000, transportAllowance: 20_000 }, R);
    // isento: 30.000 (alimentação, limitado) + 20.000 (transporte) = 50.000
    expect(p.gross).toBe(260_000);
    expect(p.inssEmployee).toBe(6300); // 3% de 210.000
    expect(p.inssEmployer).toBe(16_800);
    expect(p.taxable).toBe(203_700);
    expect(p.irt).toBe(31_250 + Math.round(3700 * 0.18));
    expect(p.net).toBe(260_000 - 6300 - p.irt);
  });
  it('horas extra (+50%), faltas injustificadas, peça e descontos', () => {
    const p = computePay({ ...base, baseSalary: 88_000, overtimeHours: 4, unjustifiedAbsences: 2, piecePay: 15_000, otherDeductions: 1000 }, R);
    // diário 4.000; hora 500; extra 4 × 500 × 1,5 = 3.000; faltas 8.000
    expect(p.overtimePay).toBe(3000);
    expect(p.absenceDeduction).toBe(8000);
    expect(p.gross).toBe(88_000 + 3000 + 15_000 - 8000);
    expect(p.irt).toBe(0); // abaixo do limite isento
    expect(p.net).toBe(p.gross - p.inssEmployee - p.irt - 1000);
  });
});

describe('relógio biométrico', () => {
  // Formato real exportado pelo relógio (aspas simples, NULL, sem IN/OUT).
  const csv = [
    ['sName', 'sJobNo', 'sCard', 'Date', 'Time', 'IN/OUT', 'ReadID'],
    ["'Mateus Gastao", "'3", "'NULL", '2026-11-23', '08:07:13', "'NULL", '1'],
    ["'Mateus Gastao", "'3", "'NULL", '2026-11-23', '08:07:20', "'NULL", '1'],
    ["'Mateus Gastao", "'3", "'NULL", '2026-11-23', '18:40:00', "'NULL", '1'],
    ["'NULL", "'", "'NULL", '2026-11-23', '09:00:00', "'NULL", '1'], // sem n.º: ignorada
    ["'NULL", "'13", "'NULL", '2026-11-23', '08:30:00', "'NULL", '1'],
    ["'Mateus Gastao", "'3", "'NULL", '2026-11-28', '09:00:00', "'NULL", '1'], // sábado
    ["'Mateus Gastao", "'3", "'NULL", '2026-11-28', '12:10:00', "'NULL", '1'],
  ];
  const punches = parseBiometric(csv);
  const emp = [{ id: 'e3', biometricId: '3', hireDate: '2020-01-01' }];
  const { rows, unmatched } = attendanceFromPunches(punches, emp, { from: '2026-11-23', to: '2026-11-29' }, DEFAULT_SCHEDULE, ['2026-11-25']);
  const on = (d: string) => rows.find((r) => r.date === d);

  it('lê o ficheiro e ignora marcações sem n.º', () => {
    expect(punches).toHaveLength(6);
    expect(punches[0]).toEqual({ id: '3', name: 'Mateus Gastao', date: '2026-11-23', time: '08:07' });
    expect(parseBiometric([['Data', 'Hora', 'ID'], [new Date('2026-11-23T00:00:00Z'), 0.5, 7]])).toEqual([{ id: '7', name: '', date: '2026-11-23', time: '12:00' }]);
  });
  it('entrada/saída, horas extra em meias horas, marcações repetidas', () => {
    expect(on('2026-11-23')).toMatchObject({ status: 'PRESENT', checkIn: '08:07', checkOut: '18:40', overtimeHours: 1.5 });
  });
  it('sábado: sem atraso, todo o tempo é extra', () => {
    expect(on('2026-11-28')).toMatchObject({ status: 'PRESENT', overtimeHours: 3 });
  });
  it('dias úteis sem marcação = falta (feriado e domingo não)', () => {
    expect(rows.filter((r) => r.status === 'ABSENT').map((r) => r.date)).toEqual(['2026-11-24', '2026-11-26', '2026-11-27']);
    expect(on('2026-11-25')).toBeUndefined();
  });
  it('atraso depois da tolerância; n.º sem trabalhador é reportado', () => {
    const late = attendanceFromPunches([{ id: '3', name: '', date: '2026-11-23', time: '08:16' }], emp, { from: '2026-11-23', to: '2026-11-23' }, DEFAULT_SCHEDULE);
    expect(late.rows[0]).toMatchObject({ status: 'LATE', checkOut: null });
    expect(unmatched).toEqual([{ id: '13', name: '', punches: 1 }]);
  });
  it('marcação única à tarde = saída sem entrada (não é atraso)', () => {
    const r = attendanceFromPunches([{ id: '3', name: '', date: '2026-11-23', time: '17:57' }], emp, { from: '2026-11-23', to: '2026-11-23' }, DEFAULT_SCHEDULE).rows[0];
    expect(r).toMatchObject({ status: 'PRESENT', checkIn: null, checkOut: '17:57', overtimeHours: 0.5, incomplete: true });
  });
});

describe('pagamento parcelado de salários', () => {
  it('% do líquido ou valor fixo, nunca acima do que falta', () => {
    expect(salaryInstalment(100_001, 0, 50)).toBe(50_001);
    expect(salaryInstalment(100_000, 50_000, 100)).toBe(50_000);
    expect(salaryInstalment(100_000, 80_000, 50)).toBe(20_000);
    expect(salaryInstalment(100_000, 0, 100, 30_000)).toBe(30_000);
    expect(salaryInstalment(100_000, 100_000)).toBe(0);
  });
});
