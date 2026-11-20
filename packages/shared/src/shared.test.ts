import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, formatKz, hasPermission } from './index';

describe('formatKz', () => {
  it('formata com pontos e Kz', () => {
    expect(formatKz(1440000)).toBe('1.440.000 Kz');
    expect(formatKz(0)).toBe('0 Kz');
    expect(formatKz(999)).toBe('999 Kz');
    expect(formatKz(-1234567)).toBe('-1.234.567 Kz');
  });
});

describe('hasPermission', () => {
  const role = (n: string) => DEFAULT_ROLES.find((r) => r.name === n)!;
  it('admin tem tudo', () => expect(hasPermission({ isAdmin: true, permissions: [] }, 'finance.delete')).toBe(true));
  it('comercial não acede ao backoffice', () =>
    expect(hasPermission(role('Comercial'), 'backoffice.view')).toBe(false));
  it('gestor aprova propostas mas só vê o backoffice', () => {
    expect(hasPermission(role('Gestor'), 'pipeline.approve')).toBe(true);
    expect(hasPermission(role('Gestor'), 'backoffice.edit')).toBe(false);
  });
  it('produção não vê financeiro', () => expect(hasPermission(role('Produção/Stock'), 'finance.view')).toBe(false));
});

import { lineTotal, needsApproval, normalizePhone, proposalTotal } from './commercial';

describe('regras comerciais', () => {
  it('total de linha arredonda a Kz inteiros', () => {
    expect(lineTotal(3, 1000)).toBe(3000);
    expect(lineTotal(1.5, 333, 10)).toBe(450); // 449.55
    expect(lineTotal(2, 1000, 100)).toBe(0);
  });
  it('total da proposta soma linhas', () =>
    expect(proposalTotal([{ quantity: 2, unitPrice: 500 }, { quantity: 1, unitPrice: 1000, discountPct: 50 }])).toBe(1500));
  it('aprovação quando total ≥ limite', () => {
    expect(needsApproval(4_999_999, 5_000_000)).toBe(false);
    expect(needsApproval(5_000_000, 5_000_000)).toBe(true);
    expect(needsApproval(0, 0)).toBe(true);
  });
  it('normaliza telefones angolanos', () => {
    expect(normalizePhone('923 456 789')).toBe('244923456789');
    expect(normalizePhone('+244 923-456-789')).toBe('244923456789');
    expect(normalizePhone('00244923456789')).toBe('244923456789');
  });
});
