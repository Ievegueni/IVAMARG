import { describe, expect, it } from 'vitest';
import { computeCommission, receivableStatus, type CommissionRule } from './finance';

const rule = (r: Partial<CommissionRule>): CommissionRule => ({ id: Math.random().toString(), type: 'PERCENT', value: 2, base: 'INVOICED', userId: null, businessLineId: null, productModelId: null, ...r });

describe('comissões', () => {
  const doc = { sellerId: 'ana', businessLineId: 'unif', items: [{ amount: 100_000, quantity: 10, productModelId: 'polo' }, { amount: 50_000, quantity: 5, productModelId: 'calca' }] };

  it('percentagem sobre o facturado', () => {
    expect(computeCommission(doc, [rule({ value: 3 })], 'INVOICED')).toMatchObject({ amount: 4500, baseAmount: 150_000 });
  });

  it('regra mais específica ganha (comercial > linha > geral; produto > comercial)', () => {
    const rules = [rule({ value: 1 }), rule({ value: 2, businessLineId: 'unif' }), rule({ value: 5, userId: 'ana' }), rule({ type: 'FIXED', value: 300, productModelId: 'polo' })];
    // polo: 300 Kz × 10 un; calça: 5% de 50.000
    expect(computeCommission(doc, rules, 'INVOICED').amount).toBe(3000 + 2500);
    // outro comercial: linha de negócio (2%)
    expect(computeCommission({ ...doc, sellerId: 'rui' }, rules.slice(0, 2), 'INVOICED').amount).toBe(3000);
  });

  it('valor fixo sem produto conta uma vez por documento', () => {
    expect(computeCommission(doc, [rule({ type: 'FIXED', value: 10_000 })], 'INVOICED').amount).toBe(10_000);
  });

  it('base recebido: só regras de recebido, proporcional ao pago', () => {
    const rules = [rule({ value: 10, base: 'INVOICED' }), rule({ value: 4, base: 'RECEIVED' }), rule({ type: 'FIXED', value: 1000, base: 'RECEIVED', productModelId: 'polo' })];
    // pagamento de 60% do documento
    const r = computeCommission({ ...doc, share: 0.6 }, rules, 'RECEIVED');
    expect(r.amount).toBe(Math.round(1000 * 10 * 0.6 + 50_000 * 0.6 * 0.04)); // 6000 + 1200
    expect(r.baseAmount).toBe(90_000);
  });

  it('sem regra aplicável → 0', () => {
    expect(computeCommission(doc, [rule({ userId: 'outro' })], 'INVOICED')).toMatchObject({ amount: 0, baseAmount: 0 });
  });
});

describe('estado de conta a receber', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('pago, parcial, aberto, em atraso', () => {
    expect(receivableStatus({ amount: 100, paid: 100, dueDate: '2026-01-01' }, now)).toBe('PAID');
    expect(receivableStatus({ amount: 100, paid: 40, dueDate: '2026-12-01' }, now)).toBe('PARTIAL');
    expect(receivableStatus({ amount: 100, paid: 0, dueDate: null }, now)).toBe('OPEN');
    expect(receivableStatus({ amount: 100, paid: 40, dueDate: '2026-11-09' }, now)).toBe('OVERDUE');
    expect(receivableStatus({ amount: 100, paid: 0, dueDate: '2026-11-10' }, now)).toBe('OPEN'); // vence hoje
  });
});
