// Regras financeiras puras (comissões, estado de contas a receber).

export const COMMISSION_BASE = { INVOICED: 'Valor facturado', RECEIVED: 'Valor recebido' } as const;
export const COMMISSION_TYPE = { PERCENT: 'Percentagem', FIXED: 'Valor fixo' } as const;
export const COMMISSION_STATUS = { CALCULATED: 'Calculada', APPROVED: 'Aprovada', PAID: 'Paga' } as const;
export const PAYMENT_METHODS = { TRANSFER: 'Transferência', CASH: 'Numerário', TPA: 'TPA / Multicaixa', CHEQUE: 'Cheque', OTHER: 'Outro' } as const;
export const RECEIVABLE_STATUS = { OPEN: 'Em aberto', PARTIAL: 'Parcial', PAID: 'Pago', OVERDUE: 'Em atraso' } as const;

export type CommissionRule = {
  id: string;
  type: 'PERCENT' | 'FIXED';
  value: number; // % (ex.: 2.5) ou Kz
  base: 'INVOICED' | 'RECEIVED';
  userId: string | null;
  businessLineId: string | null;
  productModelId: string | null;
};
export type CommissionItem = { amount: number; quantity: number; productModelId?: string | null };

/** Especificidade: produto > comercial > linha de negócio > geral. */
const score = (r: CommissionRule) => (r.productModelId ? 4 : 0) + (r.userId ? 2 : 0) + (r.businessLineId ? 1 : 0);

/**
 * Comissão de um documento (factura ou recebimento) para um comercial.
 * Cada linha usa a regra mais específica que se aplica. PERCENT = % do valor da linha;
 * FIXED com produto = Kz por unidade; FIXED sem produto = Kz uma vez por documento.
 * `share` = fracção do documento que conta (recebimento parcial = pago / total).
 */
export function computeCommission(
  doc: { sellerId: string; businessLineId: string | null; items: CommissionItem[]; share?: number },
  rules: CommissionRule[],
  base: 'INVOICED' | 'RECEIVED',
) {
  const share = doc.share ?? 1;
  const applicable = rules
    .filter((r) => r.base === base && (!r.userId || r.userId === doc.sellerId) && (!r.businessLineId || r.businessLineId === doc.businessLineId))
    .sort((a, b) => score(b) - score(a));
  let amount = 0;
  let baseAmount = 0;
  const fixedDocRules = new Set<string>();
  const used = new Set<string>();
  for (const it of doc.items) {
    const rule = applicable.find((r) => !r.productModelId || r.productModelId === it.productModelId);
    if (!rule) continue;
    used.add(rule.id);
    baseAmount += it.amount * share;
    if (rule.type === 'PERCENT') amount += it.amount * share * (rule.value / 100);
    else if (rule.productModelId) amount += rule.value * it.quantity * share;
    else fixedDocRules.add(rule.id);
  }
  for (const id of fixedDocRules) amount += applicable.find((r) => r.id === id)!.value * share;
  return { amount: Math.round(amount), baseAmount: Math.round(baseAmount), ruleIds: [...used] };
}

/** Estado de uma conta a receber num dado dia. */
export function receivableStatus(r: { amount: number; paid: number; dueDate: Date | string | null }, now = new Date()) {
  if (r.paid >= r.amount) return 'PAID' as const;
  if (r.dueDate && new Date(r.dueDate) < new Date(now.toISOString().slice(0, 10))) return 'OVERDUE' as const;
  return r.paid > 0 ? ('PARTIAL' as const) : ('OPEN' as const);
}
