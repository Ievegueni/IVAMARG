// Valores iniciais configuráveis no backoffice (usados pelo seed e na criação de linhas de negócio).
export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Novo' },
  { name: 'Em negociação' },
  { name: 'Proposta enviada' },
  { name: 'Aprovado', isWon: true },
  { name: 'Perdido', isLost: true },
];
