// Regras comerciais partilhadas entre API (cálculo oficial) e web (pré-visualização).

/** Total de uma linha em AOA inteiros: qtd × preço × (1 − desconto%). */
export const lineTotal = (quantity: number, unitPrice: number, discountPct = 0) =>
  Math.round(quantity * unitPrice * (1 - discountPct / 100));

export const proposalTotal = (items: { quantity: number; unitPrice: number; discountPct?: number }[]) =>
  items.reduce((sum, i) => sum + lineTotal(i.quantity, i.unitPrice, i.discountPct), 0);

/** Aprovação obrigatória quando total ≥ limite (CLAUDE.md §5.5). Limite 0 = sempre. */
export const needsApproval = (total: number, threshold: number) => total >= threshold;

/** Telefone normalizado para comparação: só dígitos, com indicativo 244 em números angolanos de 9 dígitos. */
export function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '').replace(/^00/, '');
  return d.length === 9 && d.startsWith('9') ? `244${d}` : d;
}

/** Soma de uma grelha de tamanhos { S: 10, M: 25 } */
export const gridTotal = (grid: Record<string, number>) => Object.values(grid).reduce((s, n) => s + (Number(n) || 0), 0);

export const PROPOSAL_STATUS = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Aguarda aprovação',
  APPROVED: 'Aprovada (pronta a enviar)',
  REJECTED: 'Rejeitada internamente',
  SENT: 'Enviada ao cliente',
  ACCEPTED: 'Aceite pelo cliente',
  DECLINED: 'Recusada pelo cliente',
} as const;
export type ProposalStatus = keyof typeof PROPOSAL_STATUS;

export const ORDER_STATUS = {
  DRAFT: 'Rascunho',
  CONFIRMED: 'Confirmada',
  IN_PRODUCTION: 'Em produção',
  READY: 'Pronta',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelada',
} as const;

export const PRIORITY = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' } as const;

export const PERIODICITY = {
  ONE_TIME: 'Pontual',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  YEARLY: 'Anual',
} as const;

export const CONTRACT_STATUS = { ACTIVE: 'Activo', ENDED: 'Terminado', CANCELLED: 'Cancelado' } as const;

export const LEAD_SOURCES = {
  WHATSAPP: 'WhatsApp',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  EMAIL: 'Email',
  PHONE: 'Telefone',
  REFERRAL: 'Recomendação',
  WEBSITE: 'Website',
  VISIT: 'Visita / presencial',
  TENDER: 'Concurso público',
  OTHER: 'Outro',
} as const;

export const INTERACTION_TYPES = { NOTE: 'Nota', CALL: 'Chamada', MEETING: 'Reunião', VISIT: 'Visita', EMAIL: 'Email' } as const;
