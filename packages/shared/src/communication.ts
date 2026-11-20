// Regras de comunicação partilhadas (janela Meta, variáveis de templates).

export const CHANNELS = { WHATSAPP: 'WhatsApp', MESSENGER: 'Messenger', INSTAGRAM: 'Instagram', EMAIL: 'Email', SMS: 'SMS' } as const;
export type Channel = keyof typeof CHANNELS;
export const CONVERSATION_STATUS = { OPEN: 'Aberta', PENDING: 'Pendente', CLOSED: 'Fechada' } as const;

/** Feature flag de cada canal (email não depende de aprovação externa). */
export const CHANNEL_FLAG: Partial<Record<Channel, string>> = { WHATSAPP: 'meta.whatsapp', MESSENGER: 'meta.messenger', INSTAGRAM: 'meta.instagram', SMS: 'sms' };

const WINDOW_MS = 24 * 3600_000;

/**
 * O que se pode enviar (CLAUDE.md §5.11):
 *  - WhatsApp: texto livre até 24h após a última mensagem do cliente; fora disso só template aprovado.
 *  - Messenger/Instagram: só resposta dentro de 24h (sem templates).
 *  - Email/SMS: sem restrição de janela.
 */
export function sendPolicy(channel: Channel, lastInboundAt: Date | string | null | undefined, now = new Date()) {
  const inWindow = !!lastInboundAt && now.getTime() - new Date(lastInboundAt).getTime() < WINDOW_MS;
  const closesAt = lastInboundAt ? new Date(new Date(lastInboundAt).getTime() + WINDOW_MS) : null;
  if (channel === 'EMAIL' || channel === 'SMS') return { freeform: true, template: false, blocked: false, closesAt: null };
  if (channel === 'WHATSAPP') return { freeform: inWindow, template: true, blocked: false, closesAt };
  return { freeform: inWindow, template: false, blocked: !inWindow, closesAt };
}

/** Substitui {{variavel}} pelos valores; variáveis sem valor ficam vazias. */
export const renderTemplate = (body: string, vars: Record<string, string | number | null | undefined>) =>
  body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => (vars[k] == null ? '' : String(vars[k])));

/** Variáveis usadas num texto, pela ordem em que aparecem (ordem dos parâmetros do template WhatsApp). */
export const templateVariables = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];

export const TEMPLATE_VARIABLES = {
  cliente: 'Nome do cliente',
  encomenda: 'Nº da encomenda',
  proposta: 'Nº da proposta',
  valor: 'Valor (formatado em Kz)',
  prazo: 'Data / prazo',
  documento: 'Título do documento',
  tarefa: 'Título da tarefa',
  empresa: 'Nome da empresa',
} as const;

export const AUTOMATION_TRIGGERS = {
  PROPOSAL_SENT: 'Proposta enviada ao cliente',
  ORDER_READY: 'Encomenda pronta',
  PAYMENT_OVERDUE: 'Pagamento em atraso',
  TASK_DUE: 'Tarefa a vencer',
  DOCUMENT_EXPIRING: 'Documento a expirar',
} as const;
export type AutomationTrigger = keyof typeof AUTOMATION_TRIGGERS;
export const AUTOMATION_RECIPIENT = { CLIENT: 'Cliente', ASSIGNEE: 'Responsável (comercial / tarefa)', DIRECTION: 'Direcção (perfis com "ver todos" em relatórios)' } as const;
