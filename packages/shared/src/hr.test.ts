import { describe, expect, it } from 'vitest';
import { businessDays, computePay, irtOf, type IrtBracket, type PayrollRules } from './hr';

// Escalões de exemplo (forma da tabela do IRT; valores reais configuráveis no backoffice).
const IRT: IrtBracket[] = [
  { upTo: 100_000, fixed: 0, rate: 0, over: 0 },
  { upTo: 150_000, fixed: 0, rate: 13, over: 100_000 },
  { upTo: 200_000, fixed: 12_500, rate: 16, over: 150_000 },
  { upTo: null, fixed: 31_250, rate: 18, over: 200_000 },
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
    expect(irtOf(100_000, IRT)).toBe(0);
    expect(irtOf(120_000, IRT)).toBe(2600); // 13% de 20.000
    expect(irtOf(250_000, IRT)).toBe(31_250 + 9000); // + 18% de 50.000
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
    expect(p.net).toBe(p.gross - p.inssEmployee - 1000);
  });
});
