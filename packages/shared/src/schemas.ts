import { z } from 'zod';
import { AUTOMATION_RECIPIENT, AUTOMATION_TRIGGERS, CHANNELS, CONVERSATION_STATUS } from './communication';
import { COMMISSION_BASE, COMMISSION_TYPE, PAYMENT_METHODS } from './finance';
import { CONTRACT_STATUS, INTERACTION_TYPES, LEAD_SOURCES, ORDER_STATUS, PERIODICITY, PRIORITY } from './commercial';
import { ALL_PERMISSIONS } from './permissions';
import { ATTENDANCE_STATUS, CONTRACT_TYPES, EMPLOYEE_STATUS, LEAVE_TYPES } from './hr';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Mínimo 3 caracteres')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[a-z0-9._-]+$/, 'Só letras, números, ponto, hífen e sublinhado (sem espaços nem acentos)');

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Nome de utilizador obrigatório'),
  password: z.string().min(1, 'Palavra-passe obrigatória'),
});

export const passwordSchema = z.string().min(8, 'Mínimo 8 caracteres');

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email('Email inválido') });
export const resetPasswordSchema = z.object({ token: z.string().min(1), password: passwordSchema });

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  username: usernameSchema,
  email: z.string().trim().toLowerCase().email('Email inválido'),
  roleId: z.string().min(1, 'Perfil obrigatório'),
  password: passwordSchema,
  phone: z.string().trim().optional().nullable().transform((v) => v || null),
  extraPermissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).optional(),
});
export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  username: usernameSchema.optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  roleId: z.string().min(1).optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
  phone: z.string().trim().optional().nullable().transform((v) => v || null),
  extraPermissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).optional(),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});

export const businessLineSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  active: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const settingUpdateSchema = z.object({ value: z.unknown() });
export const featureFlagUpdateSchema = z.object({ enabled: z.boolean() });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  sort: z.string().optional(), // "campo" ou "-campo"
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const BUSINESS_LINE_KINDS = {
  CONSTRUCTION: 'Construção / obras (gera Obra)',
  UNIFORMS: 'Uniformes (gera Encomenda)',
  CLEANING: 'Limpeza e jardinagem (gera Contrato recorrente)',
  BOREHOLE: 'Furos de água (gera Furo)',
} as const;
export const businessLineCreateSchema = businessLineSchema.extend({
  kind: z.enum(Object.keys(BUSINESS_LINE_KINDS) as [keyof typeof BUSINESS_LINE_KINDS]),
});

// ─── S1: comercial ───
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const optText = z.string().trim().optional().nullable().transform((v) => v || null);
const optDate = z.coerce.date().optional().nullable();

export const clientSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  nif: optText,
  phones: z.array(z.string().trim().min(6, 'Telefone inválido')).default([]),
  email: z.string().trim().toLowerCase().email('Email inválido').optional().nullable().or(z.literal('').transform(() => null)),
  address: optText,
  notes: optText,
  tags: z.array(z.string().trim().min(1)).default([]),
  businessLineIds: z.array(z.string()).default([]),
  ownerId: z.string().optional().nullable(),
});
export type ClientInput = z.input<typeof clientSchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  role: optText,
  phone: optText,
  email: z.string().trim().toLowerCase().email('Email inválido').optional().nullable().or(z.literal('').transform(() => null)),
  isPrimary: z.boolean().default(false),
});

export const interactionSchema = z.object({
  type: z.enum(keys(INTERACTION_TYPES)),
  title: z.string().trim().min(2, 'Resumo obrigatório'),
  body: optText,
  occurredAt: z.coerce.date().optional(),
});

export const opportunitySchema = z.object({
  title: z.string().trim().min(2, 'Título obrigatório'),
  clientId: z.string().min(1, 'Cliente obrigatório'),
  businessLineId: z.string().min(1, 'Linha de negócio obrigatória'),
  stageId: z.string().optional(),
  value: z.coerce.number().int('Valor em Kz inteiros').min(0).default(0),
  ownerId: z.string().optional().nullable(),
  expectedCloseAt: optDate,
  source: z.enum(keys(LEAD_SOURCES)).optional().nullable(),
  notes: optText,
});
export const opportunityMoveSchema = z.object({ stageId: z.string().min(1), lostReason: optText });

export const pipelineStageSchema = z.object({
  businessLineId: z.string().min(1),
  name: z.string().trim().min(2, 'Nome obrigatório'),
  order: z.number().int(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const proposalItemSchema = z.object({
  description: z.string().trim().min(1, 'Descrição obrigatória'),
  quantity: z.coerce.number().positive('Quantidade > 0'),
  unitPrice: z.coerce.number().int('Preço em Kz inteiros').min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
});
export const proposalVersionSchema = z.object({
  items: z.array(proposalItemSchema).min(1, 'Pelo menos uma linha'),
  notes: optText,
  validUntil: optDate,
});
export const proposalCreateSchema = proposalVersionSchema.extend({
  title: z.string().trim().min(2, 'Título obrigatório'),
  clientId: z.string().min(1, 'Cliente obrigatório'),
  businessLineId: z.string().min(1, 'Linha de negócio obrigatória'),
  opportunityId: z.string().optional().nullable(),
  mode: z.enum(['ITEMS', 'PHASES']).default('ITEMS'),
});
export const decisionSchema = z.object({ comment: optText });

export const orderLineSchema = z.object({
  description: z.string().trim().min(1, 'Descrição obrigatória'),
  productModelId: z.string().optional().nullable().transform((v) => v || null),
  sizeGrid: z.record(z.string(), z.coerce.number().int().min(0)).default({}),
  quantity: z.coerce.number().int().min(0).optional(), // se a grelha estiver vazia
  unitPrice: z.coerce.number().int().min(0),
});
export const orderSchema = z.object({
  clientId: z.string().min(1, 'Cliente obrigatório'),
  deadline: optDate,
  priority: z.enum(keys(PRIORITY)).default('NORMAL'),
  status: z.enum(keys(ORDER_STATUS)).optional(),
  personalizationName: optText,
  personalizationNotes: optText,
  notes: optText,
  lines: z.array(orderLineSchema).min(1, 'Pelo menos uma linha'),
});

export const contractSchema = z.object({
  clientId: z.string().min(1, 'Cliente obrigatório'),
  title: z.string().trim().min(2, 'Título obrigatório'),
  businessLineId: z.string().optional().nullable(),
  startDate: z.coerce.date({ error: 'Data de início obrigatória' }),
  endDate: optDate,
  value: z.coerce.number().int('Valor em Kz inteiros').min(0),
  periodicity: z.enum(keys(PERIODICITY)),
  autoRenew: z.boolean().default(false),
  renewalNoticeDays: z.coerce.number().int().min(0).default(30),
  status: z.enum(keys(CONTRACT_STATUS)).default('ACTIVE'),
  notes: optText,
});

// ─── S2: stock e produção ───
export const STOCK_CATEGORY = { RAW_MATERIAL: 'Matéria-prima', CONSTRUCTION: 'Material de obra', CONSUMABLE: 'Consumível' } as const;
export const MOVEMENT_TYPE = { IN: 'Entrada', OUT: 'Saída', TRANSFER: 'Transferência', ADJUSTMENT: 'Ajuste', RESERVE: 'Reserva', RELEASE: 'Libertação' } as const;
export const PAY_MODEL = { FIXED: 'Fixo', PIECE: 'À peça', MIXED: 'Misto (fixo + peça)' } as const;
export const STAGE_TYPE = { INTERNAL: 'Interna', EXTERNAL: 'Externa (subcontratada)', QUALITY: 'Controlo de qualidade' } as const;
export const PO_STATUS = { DRAFT: 'Rascunho', RELEASED: 'Libertada', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' } as const;

const qty3 = z.coerce.number().positive('Quantidade > 0').multipleOf(0.001, 'Máx. 3 casas decimais');

export const stockItemSchema = z.object({
  code: z.string().trim().min(1, 'Código obrigatório').toUpperCase(),
  name: z.string().trim().min(2, 'Nome obrigatório'),
  category: z.enum(keys(STOCK_CATEGORY)).default('RAW_MATERIAL'),
  unit: z.string().trim().min(1, 'Unidade obrigatória'),
  minStock: z.coerce.number().min(0).default(0),
  active: z.boolean().default(true),
});
export const warehouseSchema = z.object({ code: z.string().trim().min(1).toUpperCase(), name: z.string().trim().min(2), active: z.boolean().default(true) });
export const manualMovementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('IN'), itemId: z.string(), warehouseId: z.string(), quantity: qty3, unitCost: z.coerce.number().min(0), notes: optText }),
  z.object({ type: z.literal('OUT'), itemId: z.string(), warehouseId: z.string(), quantity: qty3, notes: optText }),
  z.object({ type: z.literal('TRANSFER'), itemId: z.string(), warehouseId: z.string(), toWarehouseId: z.string(), quantity: qty3, notes: optText }),
  z.object({ type: z.literal('ADJUSTMENT'), itemId: z.string(), warehouseId: z.string(), delta: z.coerce.number().refine((v) => v !== 0, 'Ajuste não pode ser 0'), notes: z.string().trim().min(3, 'Indique o motivo do ajuste') }),
]);
export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  nif: optText,
  phone: optText,
  email: z.string().trim().toLowerCase().email('Email inválido').optional().nullable().or(z.literal('').transform(() => null)),
  address: optText,
  notes: optText,
});
export const purchaseSchema = z.object({
  supplierId: z.string().min(1, 'Fornecedor obrigatório'),
  warehouseId: z.string().min(1, 'Armazém obrigatório'),
  expectedAt: optDate,
  notes: optText,
  lines: z.array(z.object({ itemId: z.string().min(1), quantity: qty3, unitCost: z.coerce.number().int('Custo em Kz inteiros').min(0) })).min(1, 'Pelo menos uma linha'),
});
export const inventoryCountsSchema = z.object({ lines: z.array(z.object({ itemId: z.string(), counted: z.coerce.number().min(0).nullable() })) });

export const productModelSchema = z.object({
  reference: z.string().trim().min(1, 'Referência obrigatória').toUpperCase(),
  name: z.string().trim().min(2, 'Nome obrigatório'),
  basePrice: z.coerce.number().int().min(0).default(0),
  description: optText,
  photos: z.array(z.string().startsWith('data:image/')).max(4).default([]),
  active: z.boolean().default(true),
  bom: z.array(z.object({ stockItemId: z.string().min(1), size: z.string().trim().optional().nullable().transform((v) => v || null), consumption: z.coerce.number().positive('Consumo > 0') })).default([]),
  standardTimes: z.array(z.object({ stageId: z.string(), minutesPerPiece: z.coerce.number().positive() })).default([]),
});

export const sectionSchema = z.object({ name: z.string().trim().min(2), active: z.boolean().default(true) });
export const productionStageSchema = z.object({
  name: z.string().trim().min(2),
  order: z.coerce.number().int(),
  type: z.enum(keys(STAGE_TYPE)).default('INTERNAL'),
  sectionId: z.string().optional().nullable(),
  active: z.boolean().default(true),
});
export const operatorSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  code: z.string().trim().min(1, 'Código obrigatório').toUpperCase(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN de 4 a 6 dígitos').optional(),
  sectionId: z.string().optional().nullable(),
  payModel: z.enum(keys(PAY_MODEL)).default('PIECE'),
  fixedSalary: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});
export const stageRateSchema = z.object({ stageId: z.string(), productModelId: z.string().optional().nullable(), rate: z.coerce.number().int().min(0) });
export const defectTypeSchema = z.object({ name: z.string().trim().min(2), active: z.boolean().default(true) });

export const releaseSchema = z.object({ force: z.boolean().default(false) });
export const issueSchema = z.object({ lines: z.array(z.object({ itemId: z.string(), quantity: qty3 })).min(1) });
export const stageStartSchema = z.object({
  lotId: z.string(),
  stageId: z.string(),
  quantity: z.coerce.number().int().positive('Quantidade > 0'),
  operatorId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(), // etapa externa
  notes: optText,
});
export const stageFinishSchema = z.object({
  qtyDone: z.coerce.number().int().min(0),
  qtyRejected: z.coerce.number().int().min(0).default(0),
  qtyRework: z.coerce.number().int().min(0).default(0),
  reworkStageId: z.string().optional().nullable(),
  cost: z.coerce.number().int().min(0).default(0), // etapa externa
  defects: z.array(z.object({ defectTypeId: z.string(), quantity: z.coerce.number().int().positive() })).default([]),
  notes: optText,
});

// ─── S3: documentos, tarefas, agenda, facturação ───
export const LINKABLE_ENTITIES = {
  Client: 'Cliente', Opportunity: 'Oportunidade', Proposal: 'Proposta', Contract: 'Contrato', Order: 'Encomenda',
  ProductionOrder: 'Ordem de produção', Project: 'Obra', Borehole: 'Furo', Supplier: 'Fornecedor', User: 'Utilizador',
} as const;
export const DOCUMENT_MIME = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
] as const;
export const MAX_UPLOAD_MB = 20;
const linkSchema = z.object({ entity: z.enum(keys(LINKABLE_ENTITIES)), entityId: z.string().min(1) });
export const documentMetaSchema = z.object({
  title: z.string().trim().min(2, 'Título obrigatório'),
  description: optText,
  categoryId: z.string().min(1, 'Categoria obrigatória'),
  folderId: z.string().optional().nullable().transform((v) => v || null),
  tags: z.array(z.string().trim().min(1)).default([]),
  issuedAt: optDate,
  expiresAt: optDate,
  links: z.array(linkSchema).default([]),
});
export const documentCategorySchema = z.object({ name: z.string().trim().min(2), roleIds: z.array(z.string()).default([]), active: z.boolean().default(true) });
export const documentFolderSchema = z.object({ name: z.string().trim().min(1), parentId: z.string().optional().nullable() });

export const TASK_STATUS = { TODO: 'Por fazer', IN_PROGRESS: 'Em curso', DONE: 'Concluída', CANCELLED: 'Cancelada' } as const;
export const EVENT_TYPES = { MEETING: 'Reunião', VISIT: 'Visita', APPOINTMENT: 'Compromisso', OTHER: 'Outro' } as const;
export const taskSchema = z.object({
  title: z.string().trim().min(2, 'Título obrigatório'),
  description: optText,
  assigneeId: z.string().min(1, 'Responsável obrigatório'),
  dueAt: optDate,
  priority: z.enum(keys(PRIORITY)).default('NORMAL'),
  status: z.enum(keys(TASK_STATUS)).default('TODO'),
  entity: z.enum(keys(LINKABLE_ENTITIES)).optional().nullable(),
  entityId: z.string().optional().nullable(),
});
export const eventBaseSchema = z.object({
    title: z.string().trim().min(2, 'Título obrigatório'),
    description: optText,
    type: z.enum(keys(EVENT_TYPES)).default('MEETING'),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    location: optText,
    attendeeIds: z.array(z.string()).default([]),
    entity: z.enum(keys(LINKABLE_ENTITIES)).optional().nullable(),
    entityId: z.string().optional().nullable(),
});
export const eventSchema = eventBaseSchema.refine((e) => e.endAt >= e.startAt, { message: 'O fim tem de ser depois do início', path: ['endAt'] });

export const INVOICE_STATUS = { PENDING: 'Em emissão', ISSUED: 'Emitida', FAILED: 'Falhou', CANCELLED: 'Anulada' } as const;
export const invoiceRequestSchema = z.object({
  source: z.enum(['Order', 'Proposal', 'Contract']),
  sourceId: z.string().min(1),
  dueDate: optDate,
});

// ─── S4: comunicação ───
export const templateSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  channels: z.array(z.enum(keys(CHANNELS))).min(1, 'Escolha pelo menos um canal'),
  subject: optText, // email
  body: z.string().trim().min(2, 'Texto obrigatório'),
  waTemplateName: optText, // nome do template aprovado na Meta
  waLanguage: z.string().default('pt_PT'),
  active: z.boolean().default(true),
});
export const automationSchema = z.object({
  name: z.string().trim().min(2),
  trigger: z.enum(keys(AUTOMATION_TRIGGERS)),
  channel: z.enum(keys(CHANNELS)),
  templateId: z.string().min(1, 'Template obrigatório'),
  recipient: z.enum(keys(AUTOMATION_RECIPIENT)),
  active: z.boolean().default(true),
});
export const sendMessageSchema = z.object({
  body: z.string().trim().max(4096).optional(),
  templateId: z.string().optional(),
  note: z.boolean().default(false), // nota interna (não é enviada)
  attachmentDocumentId: z.string().optional(),
});
export const conversationUpdateSchema = z.object({
  status: z.enum(keys(CONVERSATION_STATUS)).optional(),
  assigneeId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
});
export const newConversationSchema = z.object({ clientId: z.string(), channel: z.enum(keys(CHANNELS)), to: z.string().trim().min(3) });
export const simulateInboundSchema = z.object({ channel: z.enum(['WHATSAPP', 'MESSENGER', 'INSTAGRAM']), from: z.string().trim().min(3), name: z.string().optional(), text: z.string().trim().min(1) });

// ─── S5: financeiro ───
export const paymentSchema = z.object({
  amount: z.coerce.number().int('Kz inteiros').positive('Valor > 0'),
  method: z.enum(keys(PAYMENT_METHODS)),
  paidAt: z.coerce.date(),
  reference: optText,
  notes: optText,
});
export const receivableSchema = z.object({
  clientId: z.string().min(1, 'Cliente obrigatório'),
  description: z.string().trim().min(2),
  amount: z.coerce.number().int().positive(),
  dueDate: optDate,
  businessLineId: z.string().optional().nullable(),
});
export const entrySchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  categoryId: z.string().min(1, 'Categoria obrigatória'),
  amount: z.coerce.number().int('Kz inteiros').positive('Valor > 0'),
  date: z.coerce.date(),
  description: z.string().trim().min(2, 'Descrição obrigatória'),
  businessLineId: z.string().optional().nullable().transform((v) => v || null),
  entity: z.enum(['Order', 'Project', 'Borehole', 'Contract']).optional().nullable(),
  entityId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable().transform((v) => v || null),
});
export const commissionRuleSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(keys(COMMISSION_TYPE)),
  value: z.coerce.number().positive(),
  base: z.enum(keys(COMMISSION_BASE)),
  userId: z.string().optional().nullable().transform((v) => v || null),
  businessLineId: z.string().optional().nullable().transform((v) => v || null),
  productModelId: z.string().optional().nullable().transform((v) => v || null),
  active: z.boolean().default(true),
});
export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Período AAAA-MM');

// ─── S6: operações ───
export const OPERATION_STATUS = { PLANNED: 'Planeada', IN_PROGRESS: 'Em curso', SUSPENDED: 'Suspensa', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' } as const;
export const PHASE_STATUS = { PENDING: 'Por iniciar', IN_PROGRESS: 'Em curso', DONE: 'Concluída' } as const;
export const VISIT_STATUS = { PLANNED: 'Planeada', DONE: 'Realizada', MISSED: 'Falhada', CANCELLED: 'Cancelada' } as const;
export const operationSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  clientId: z.string().min(1, 'Cliente obrigatório'),
  description: optText,
  location: optText,
  gps: optText,
  budget: z.coerce.number().int().min(0).default(0),
  startDate: optDate,
  endDate: optDate,
  status: z.enum(keys(OPERATION_STATUS)).default('PLANNED'),
  managerId: z.string().optional().nullable().transform((v) => v || null),
  team: z.array(z.string()).default([]),
  crew: optText,
  result: z.record(z.string(), z.string()).optional(),
});
export const phaseSchema = z.object({
  name: z.string().trim().min(2),
  order: z.coerce.number().int(),
  budget: z.coerce.number().int().min(0).default(0),
  status: z.enum(keys(PHASE_STATUS)).default('PENDING'),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  plannedStart: optDate,
  plannedEnd: optDate,
  notes: optText,
});
export const visitPlanSchema = z.object({
  visitDays: z.array(z.number().int().min(1).max(7)).min(1, 'Escolha os dias'),
  visitTime: z.string().regex(/^\d{2}:\d{2}$/, 'Hora HH:MM'),
  visitTeam: optText,
  weeks: z.coerce.number().int().min(1).max(26).default(4),
});
export const visitUpdateSchema = z.object({
  status: z.enum(keys(VISIT_STATUS)).optional(),
  notes: optText,
  team: optText,
  scheduledAt: z.coerce.date().optional(),
  checklist: z.array(z.object({ item: z.string(), done: z.boolean() })).optional(),
});

// ── RH ──
const kzInt = z.coerce.number().int().min(0).default(0);
export const employeeSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório'),
  bi: optText,
  nif: optText,
  inssNumber: optText,
  birthDate: optDate,
  phone: optText,
  email: z.string().trim().toLowerCase().email('Email inválido').optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: optText,
  position: z.string().trim().min(2, 'Função obrigatória'),
  department: optText,
  hireDate: z.coerce.date({ error: 'Data de admissão obrigatória' }),
  contractType: z.enum(keys(CONTRACT_TYPES)).default('EFFECTIVE'),
  contractEnd: optDate,
  baseSalary: kzInt,
  mealAllowance: kzInt,
  transportAllowance: kzInt,
  otherAllowances: kzInt,
  vacationDays: z.coerce.number().int().min(0).max(60).default(22),
  bank: optText,
  iban: optText,
  status: z.enum(keys(EMPLOYEE_STATUS)).default('ACTIVE'),
  operatorId: z.string().optional().nullable().transform((v) => v || null),
  notes: optText,
});
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida').optional().nullable().or(z.literal('')).transform((v) => v || null);
export const attendanceSheetSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(z.object({
    employeeId: z.string().min(1),
    status: z.enum(keys(ATTENDANCE_STATUS)),
    checkIn: hhmm,
    checkOut: hhmm,
    overtimeHours: z.coerce.number().min(0).max(24).default(0),
    notes: optText,
  })),
});
export const leaveSchema = z.object({
  employeeId: z.string().min(1, 'Trabalhador obrigatório'),
  type: z.enum(keys(LEAVE_TYPES)).default('VACATION'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  reason: optText,
}).refine((d) => d.endDate >= d.startDate, { message: 'A data de fim é anterior ao início', path: ['endDate'] });
export const payslipUpdateSchema = z.object({ bonus: kzInt.optional(), otherDeductions: kzInt.optional(), notes: optText });
const pct = z.number().min(0).max(100);
export const payrollRulesSchema = z.object({
  workingDays: z.number().int().min(1).max(31),
  hoursPerDay: z.number().min(1).max(24),
  overtimeRate: pct,
  inssEmployee: pct,
  inssEmployer: pct,
  allowanceExempt: z.number().int().min(0),
  irt: z.array(z.object({ upTo: z.number().int().positive().nullable(), fixed: z.number().int().min(0), rate: pct, over: z.number().int().min(0) })).min(1)
    .refine((b) => b[b.length - 1].upTo === null, 'O último escalão do IRT deve ter "upTo": null'),
});
