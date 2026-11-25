// Idempotente: só cria o que falta, nunca sobrescreve configurações editadas no backoffice.
import { DEFAULT_ROLES } from '@ivamarg/shared';
import { PrismaClient, type BusinessLineKind } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_PIPELINE_STAGES } from '../src/lib/defaults';

const prisma = new PrismaClient();

for (const r of DEFAULT_ROLES) {
  await prisma.role.upsert({ where: { name: r.name }, update: {}, create: { name: r.name, isAdmin: !!r.isAdmin, permissions: r.permissions } });
}

const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@ivamarg.ao').toLowerCase();
const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('Definir SEED_ADMIN_PASSWORD no .env');
const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Administrador' } });
await prisma.user.upsert({
  where: { email },
  update: {},
  create: { name: 'Administrador', username, email, passwordHash: await bcrypt.hash(password, 10), roleId: adminRole.id },
});

const settings = [
  { key: 'users.maxActive', value: 6, label: 'Limite de utilizadores activos', description: 'Número máximo de contas activas em simultâneo.' },
  { key: 'company.name', value: 'Ivamarg, Lda', label: 'Nome da empresa', description: 'Usado em PDFs e emails.' },
  { key: 'company.nif', value: '', label: 'NIF da empresa', description: 'Aparece nas propostas.' },
  { key: 'company.address', value: 'Luanda, Angola', label: 'Morada da empresa', description: 'Aparece nas propostas.' },
  { key: 'company.contacts', value: '', label: 'Contactos da empresa', description: 'Telefone / email no rodapé das propostas.' },
  { key: 'company.logo', value: '', label: 'Logótipo', description: 'Imagem PNG/JPG usada nas propostas em PDF.' },
  {
    key: 'proposals.approvalThreshold',
    value: 5000000,
    label: 'Limite de aprovação de propostas (Kz)',
    description: 'Propostas com total igual ou superior precisam de aprovação de um utilizador com permissão "Aprovar" em Pipeline.',
  },
  { key: 'proposals.validityDays', value: 30, label: 'Validade das propostas (dias)', description: 'Validade sugerida em propostas novas.' },
  { key: 'production.opMode', value: 'PER_ORDER', label: 'Ordens de produção', description: 'PER_ORDER = 1 OP por encomenda; PER_LINE = 1 OP por linha da encomenda.' },
  { key: 'production.lotSize', value: 50, label: 'Tamanho máximo do lote (peças)', description: 'Cada tamanho é dividido em lotes até este número de peças.' },
  { key: 'production.minMarginPct', value: 20, label: 'Margem mínima por encomenda (%)', description: 'Abaixo disto a encomenda é sinalizada.' },
  { key: 'stock.alertRoles', value: 'stock.edit', label: 'Alertas de stock mínimo', description: 'Permissão de quem recebe o alerta diário de stock mínimo.' },
  { key: 'documents.alertDays', value: [30, 15, 7], label: 'Alertas de validade de documentos (dias antes)', description: 'Separados por vírgula. Também é enviado alerta no dia em que expira.' },
  { key: 'vendus.mode', value: 'tests', label: 'Vendus: modo de emissão', description: '"tests" emite documentos de teste (sem valor fiscal); "normal" só depois de validar a API com a conta do cliente.' },
  { key: 'vendus.documentType', value: 'FT', label: 'Vendus: tipo de documento', description: 'FT = factura; FR = factura-recibo.' },
  { key: 'comms.sandbox', value: true, label: 'Comunicação em modo sandbox', description: 'Envios WhatsApp/Messenger/Instagram/SMS são simulados (registados mas não enviados). Desligar quando as contas Meta e Futurix estiverem aprovadas.' },
  { key: 'boreholes.stages', value: ['Estudo hidrogeológico', 'Licenciamento', 'Perfuração', 'Revestimento e filtro', 'Limpeza e desenvolvimento', 'Ensaio de caudal', 'Instalação da bomba', 'Entrega'], label: 'Etapas de execução de furos', description: 'Criadas em cada furo novo. Separadas por vírgula.' },
  { key: 'cleaning.checklist', value: ['Áreas comuns', 'Casas de banho', 'Recolha de lixo', 'Jardim / rega', 'Vidros'], label: 'Checklist de visitas de limpeza', description: 'Itens a confirmar em cada visita. Separados por vírgula.' },
  {
    key: 'hr.payroll',
    value: {
      workingDays: 22, hoursPerDay: 8, overtimeRate: 50, inssEmployee: 3, inssEmployer: 8, allowanceExempt: 30000,
      irt: [
        { upTo: 100000, fixed: 0, rate: 0, over: 0 },
        { upTo: 150000, fixed: 0, rate: 13, over: 100000 },
        { upTo: 200000, fixed: 12500, rate: 16, over: 150000 },
        { upTo: 300000, fixed: 31250, rate: 18, over: 200000 },
        { upTo: 500000, fixed: 49250, rate: 19, over: 300000 },
        { upTo: 1000000, fixed: 87250, rate: 20, over: 500000 },
        { upTo: 1500000, fixed: 187250, rate: 21, over: 1000000 },
        { upTo: 2000000, fixed: 292250, rate: 22, over: 1500000 },
        { upTo: 2500000, fixed: 402250, rate: 23, over: 2000000 },
        { upTo: 5000000, fixed: 517250, rate: 24, over: 2500000 },
        { upTo: 10000000, fixed: 1117250, rate: 24.5, over: 5000000 },
        { upTo: null, fixed: 2342250, rate: 25, over: 10000000 },
      ],
    },
    label: 'RH: regras de salário (INSS / IRT)',
    description: 'A VALIDAR PELO CONTABILISTA. Tabela do IRT (Grupo A, Lei 28/20 com isenção até 100.000 Kz): parcela fixa + taxa % sobre o excesso. INSS 3% trabalhador / 8% empresa. Subsídios de alimentação e transporte isentos até "allowanceExempt" cada.',
  },
  { key: 'hr.holidays', value: ['2026-01-01', '2026-02-04', '2026-02-17', '2026-03-08', '2026-03-23', '2026-04-03', '2026-04-04', '2026-05-01', '2026-09-17', '2026-11-02', '2026-11-11', '2026-12-25'], label: 'RH: feriados', description: 'Datas AAAA-MM-DD separadas por vírgula. Não contam como dias de férias.' },
  { key: 'hr.schedule', value: { start: '08:00', end: '17:00', toleranceMinutes: 15, minOvertimeMinutes: 30 }, label: 'RH: horário (relógio biométrico)', description: 'Entrada/saída (HH:MM), tolerância de atraso e mínimo de minutos para contar horas extra (contadas em meias horas). Usado na importação do biométrico.' },
  { key: 'hr.payDay', value: { day: 25, nextMonth: false }, label: 'RH: dia de pagamento dos salários', description: '"day" = dia do mês; "nextMonth": true se o salário de um mês é pago no mês seguinte. Alertas 3 dias antes, no dia e semanalmente enquanto houver salários por pagar.' },
  { key: 'hr.birthdayMessage', value: 'Parabéns, {{primeiro_nome}}! A {{empresa}} deseja-lhe um feliz aniversário e um excelente ano.', label: 'RH: mensagem de aniversário', description: 'Enviada ao trabalhador no dia de anos (SMS se activo, senão email). Variáveis: {{nome}}, {{primeiro_nome}}, {{empresa}}. Vazio = não enviar.' },
  { key: 'hr.documentMessage', value: 'Olá {{primeiro_nome}}, o seu documento "{{documento}}" {{situacao}} ({{data}}). Por favor entregue a versão actualizada nos Recursos Humanos. {{empresa}}', label: 'RH: mensagem de documento a expirar', description: 'Enviada ao trabalhador ligado ao documento nos alertas de validade. Variáveis: {{nome}}, {{primeiro_nome}}, {{documento}}, {{situacao}}, {{data}}, {{empresa}}. Vazio = não enviar.' },
  { key: 'finance.payablesAlertDays', value: 3, label: 'Alerta de pagamentos a fornecedores (dias antes)', description: 'Aviso no sino quando faltam estes dias para o vencimento; depois, no 1.º dia de atraso e semanalmente.' },
  { key: 'orders.sizes', value: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'], label: 'Tamanhos (grelha de encomendas)', description: 'Separados por vírgula.' },
];
for (const s of settings) await prisma.setting.upsert({ where: { key: s.key }, update: {}, create: s });

const flags = [
  { key: 'meta.whatsapp', label: 'WhatsApp (Cloud API)', description: 'Depende de aprovação Meta.' },
  { key: 'meta.messenger', label: 'Facebook Messenger', description: 'Depende de aprovação Meta.' },
  { key: 'meta.instagram', label: 'Instagram', description: 'Depende de aprovação Meta.' },
  { key: 'whatsapp.calls', label: 'Chamadas WhatsApp', description: 'Depende de elegibilidade Meta para chamadas.' },
  { key: 'sms', label: 'SMS (Futurix)', description: 'Requer credenciais Futurix.' },
];
for (const f of flags) await prisma.featureFlag.upsert({ where: { key: f.key }, update: {}, create: f });

if (!(await prisma.businessLine.count())) {
  const lines: { name: string; kind: BusinessLineKind }[] = [
    { name: 'Construção civil e obras públicas', kind: 'CONSTRUCTION' },
    { name: 'Fábrica de uniformes', kind: 'UNIFORMS' },
    { name: 'Limpeza e jardinagem', kind: 'CLEANING' },
    { name: 'Furos de água', kind: 'BOREHOLE' },
  ];
  for (const [i, l] of lines.entries()) {
    await prisma.businessLine.create({
      data: { ...l, order: i + 1, pipelineStages: { create: DEFAULT_PIPELINE_STAGES.map((s, j) => ({ ...s, order: j + 1 })) } },
    });
  }
}

if (!(await prisma.productionStage.count())) {
  await prisma.productionStage.createMany({
    data: ['Corte', 'Costura', 'Bordado/Estampagem', 'Acabamento', 'Embalagem'].map((name, i) => ({ name, order: i + 1 })),
  });
}

// Ponto de inspecção de qualidade antes da embalagem (CLAUDE.md §5.7).
if (!(await prisma.productionStage.count({ where: { type: 'QUALITY' } }))) {
  const pack = await prisma.productionStage.findFirst({ where: { name: 'Embalagem' } });
  const order = pack?.order ?? (await prisma.productionStage.count()) + 1;
  await prisma.productionStage.updateMany({ where: { order: { gte: order } }, data: { order: { increment: 1 } } });
  await prisma.productionStage.create({ data: { name: 'Controlo de qualidade', order, type: 'QUALITY' } });
}

if (!(await prisma.warehouse.count())) {
  await prisma.warehouse.create({ data: { code: 'PRINCIPAL', name: 'Armazém principal' } });
}

if (!(await prisma.productionSection.count())) {
  await prisma.productionSection.createMany({ data: ['Corte', 'Costura', 'Acabamento'].map((name) => ({ name })) });
}

if (!(await prisma.defectType.count())) {
  await prisma.defectType.createMany({
    data: ['Costura defeituosa', 'Medida incorrecta', 'Tecido danificado', 'Mancha / sujidade', 'Bordado/estampagem defeituoso', 'Cor incorrecta'].map(
      (name) => ({ name }),
    ),
  });
}

if (!(await prisma.documentCategory.count())) {
  const restricted = (await prisma.role.findMany({ where: { name: { in: ['Administrador', 'Gestor'] } } })).map((r) => r.id);
  const cats: [string, string[]][] = [
    ['Contratos', []],
    ['Alvarás e licenças', []],
    ['Certidões', []],
    ['Fichas técnicas', []],
    ['Projectos / plantas', []],
    ['Fornecedores', []],
    ['RH', restricted],
  ];
  await prisma.documentCategory.createMany({ data: cats.map(([name, roleIds]) => ({ name, roleIds })) });
}

if (!(await prisma.messageTemplate.count())) {
  await prisma.messageTemplate.createMany({
    data: [
      { name: 'Encomenda pronta', channels: ['WHATSAPP', 'SMS', 'EMAIL'], subject: 'A sua encomenda {{encomenda}} está pronta', body: 'Olá {{cliente}}, a sua encomenda {{encomenda}} está pronta para entrega. {{empresa}}' },
      { name: 'Proposta enviada', channels: ['WHATSAPP', 'EMAIL'], subject: 'Proposta {{proposta}}', body: 'Olá {{cliente}}, enviámos a proposta {{proposta}} no valor de {{valor}}. Estamos ao dispor. {{empresa}}' },
      { name: 'Pagamento em atraso', channels: ['WHATSAPP', 'SMS', 'EMAIL'], subject: 'Pagamento em atraso', body: 'Olá {{cliente}}, a factura no valor de {{valor}} venceu a {{prazo}}. Agradecemos a regularização. {{empresa}}' },
      { name: 'Documento a expirar', channels: ['WHATSAPP', 'EMAIL'], subject: 'Documento a expirar: {{documento}}', body: 'Atenção: o documento "{{documento}}" expira a {{prazo}}.' },
    ],
  });
}

if (!(await prisma.entryCategory.count())) {
  await prisma.entryCategory.createMany({
    data: [
      ...['Recebimentos de clientes', 'Outras receitas'].map((name) => ({ name, type: 'INCOME' })),
      ...['Matéria-prima', 'Salários', 'Subcontratação', 'Combustível e transporte', 'Energia e água', 'Rendas', 'Manutenção', 'Impostos e taxas', 'Outras despesas'].map((name) => ({ name, type: 'EXPENSE' })),
    ],
  });
}

// KPIs (CLAUDE.md §5.14) - activáveis no backoffice.
const kpis: [string, string, string, boolean][] = [
  ['tasks_on_time', 'Tarefas concluídas no prazo', '%', true],
  ['tasks_avg_days', 'Tempo médio de conclusão de tarefas', 'dias', false],
  ['pieces_per_day', 'Peças por dia (produção)', 'pç', true],
  ['efficiency', 'Eficiência vs tempo padrão', '%', true],
  ['defect_rate', 'Taxa de defeito', '%', false],
  ['rework_rate', 'Taxa de retrabalho', '%', false],
  ['scrap_rate', 'Taxa de refugo', '%', false],
  ['conversion', 'Conversão de oportunidades', '%', true],
  ['sold_value', 'Valor vendido', 'Kz', true],
  ['sales_cycle', 'Ciclo de venda', 'dias', false],
  ['orders_on_time', 'Encomendas entregues no prazo', '%', true],
];
for (const [key, name, unit, higher] of kpis) await prisma.kpiDefinition.upsert({ where: { key }, update: {}, create: { key, name, unit, higher } });

console.log(`Seed concluído. Admin: ${username} (${email})`);
await prisma.$disconnect();
