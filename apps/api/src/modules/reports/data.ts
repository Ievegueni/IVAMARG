import { formatDate, receivableStatus } from '@ivamarg/shared';
import { prisma } from '../../lib/prisma';
import { D } from '../stock/core';

// Dados dos relatórios e KPIs. Cada relatório = secções com colunas tipadas (render para ecrã, PDF e Excel).

export type ColType = 'text' | 'kz' | 'num' | 'pct' | 'date';
export type Section = { title: string; columns: { key: string; label: string; type: ColType }[]; rows: Record<string, string | number | null>[]; totals?: Record<string, number> };
export type ReportData = { title: string; subtitle: string; sections: Section[] };
export type Filters = { from: Date; to: Date; businessLineId?: string; userId?: string };

const sumBy = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const days = (ms: number) => Math.round((ms / 86400000) * 10) / 10;
const sub = (f: Filters) => `${formatDate(f.from)} a ${formatDate(f.to)}`;

// ─── Produção / produtividade ───

/** Produtividade por operador e por secção no período (peças concluídas, rejeitadas, horas, eficiência). */
export async function productivity(f: Filters) {
  const logs = await prisma.stageLog.findMany({
    where: { finishedAt: { gte: f.from, lte: f.to }, operatorId: { not: null } },
    include: { operator: { include: { section: true } }, stage: true, lot: { select: { productModelId: true } } },
  });
  const std = await prisma.standardTime.findMany();
  const stdOf = (model: string, stage: string) => Number(std.find((s) => s.productModelId === model && s.stageId === stage)?.minutesPerPiece ?? 0);
  type Acc = { pieces: number; rejected: number; minutes: number; stdMinutes: number; labour: number; days: Set<string> };
  const blank = (): Acc => ({ pieces: 0, rejected: 0, minutes: 0, stdMinutes: 0, labour: 0, days: new Set() });
  const byOp = new Map<string, Acc & { name: string; section: string }>();
  const bySection = new Map<string, Acc>();
  const byStage = new Map<string, { pieces: number; minutes: number }>();
  for (const l of logs) {
    const minutes = (l.finishedAt!.getTime() - l.startedAt.getTime()) / 60000;
    const s = stdOf(l.lot.productModelId, l.stageId) * l.qtyDone;
    const section = l.operator!.section?.name ?? 'Sem secção';
    const o = byOp.get(l.operatorId!) ?? { ...blank(), name: l.operator!.name, section };
    const sc = bySection.get(section) ?? blank();
    for (const a of [o, sc]) {
      a.pieces += l.qtyDone;
      a.rejected += l.qtyRejected;
      a.minutes += minutes;
      a.labour += l.labourCost;
      if (s) a.stdMinutes += s;
      a.days.add(l.finishedAt!.toISOString().slice(0, 10));
    }
    byOp.set(l.operatorId!, o);
    bySection.set(section, sc);
    const st = byStage.get(l.stage.name) ?? { pieces: 0, minutes: 0 };
    st.pieces += l.qtyDone;
    st.minutes += minutes;
    byStage.set(l.stage.name, st);
  }
  const row = (a: Acc) => ({
    pieces: a.pieces,
    rejected: a.rejected,
    perDay: a.days.size ? Math.round(a.pieces / a.days.size) : 0,
    hours: Math.round((a.minutes / 60) * 10) / 10,
    efficiency: a.stdMinutes && a.minutes ? pct(a.stdMinutes, a.minutes) : null,
    labour: a.labour,
  });
  return {
    operators: [...byOp.values()].map((o) => ({ name: o.name, section: o.section, ...row(o) })).sort((a, b) => b.pieces - a.pieces),
    sections: [...bySection.entries()].map(([name, a]) => ({ name, ...row(a) })),
    stages: [...byStage.entries()].map(([name, s]) => ({ name, pieces: s.pieces, minPerPiece: s.pieces ? Math.round((s.minutes / s.pieces) * 10) / 10 : null })),
  };
}

const prodCols = [
  { key: 'pieces', label: 'Peças', type: 'num' as const },
  { key: 'rejected', label: 'Rejeitadas', type: 'num' as const },
  { key: 'perDay', label: 'Peças/dia', type: 'num' as const },
  { key: 'hours', label: 'Horas', type: 'num' as const },
  { key: 'efficiency', label: 'Eficiência', type: 'pct' as const },
  { key: 'labour', label: 'Mão-de-obra', type: 'kz' as const },
];

async function productionReport(f: Filters): Promise<ReportData> {
  const p = await productivity(f);
  return {
    title: 'Relatório de produção',
    subtitle: sub(f),
    sections: [
      { title: 'Produtividade por operador', columns: [{ key: 'name', label: 'Operador', type: 'text' }, { key: 'section', label: 'Secção', type: 'text' }, ...prodCols], rows: p.operators },
      { title: 'Por secção', columns: [{ key: 'name', label: 'Secção', type: 'text' }, ...prodCols], rows: p.sections },
      { title: 'Tempo por etapa', columns: [{ key: 'name', label: 'Etapa', type: 'text' }, { key: 'pieces', label: 'Peças', type: 'num' }, { key: 'minPerPiece', label: 'Min/peça', type: 'num' }], rows: p.stages },
    ],
  };
}

// ─── Vendas, clientes, financeiro, comissões, stock ───

async function salesReport(f: Filters): Promise<ReportData> {
  const inv = await prisma.invoice.findMany({
    where: { status: 'ISSUED', issuedAt: { gte: f.from, lte: f.to }, ...(f.businessLineId && { businessLineId: f.businessLineId }), ...(f.userId && { sellerId: f.userId }) },
    orderBy: { issuedAt: 'asc' },
  });
  const [clients, users, lines] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: inv.map((i) => i.clientId) } }, select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.businessLine.findMany(),
  ]);
  const cn = new Map(clients.map((c) => [c.id, c.name]));
  const un = new Map(users.map((u) => [u.id, u.name]));
  const ln = new Map(lines.map((l) => [l.id, l.name]));
  const group = (key: (i: (typeof inv)[number]) => string) => {
    const m = new Map<string, { name: string; count: number; total: number }>();
    for (const i of inv) {
      const k = key(i);
      const g = m.get(k) ?? { name: k, count: 0, total: 0 };
      g.count++;
      g.total += i.total;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const g = [{ key: 'name', label: '', type: 'text' as const }, { key: 'count', label: 'Facturas', type: 'num' as const }, { key: 'total', label: 'Total', type: 'kz' as const }];
  return {
    title: 'Relatório de vendas',
    subtitle: sub(f),
    sections: [
      { title: 'Por comercial', columns: [{ ...g[0], label: 'Comercial' }, ...g.slice(1)], rows: group((i) => un.get(i.sellerId ?? '') ?? 'Sem comercial') },
      { title: 'Por linha de negócio', columns: [{ ...g[0], label: 'Linha' }, ...g.slice(1)], rows: group((i) => ln.get(i.businessLineId ?? '') ?? '-') },
      {
        title: 'Facturas emitidas',
        columns: [{ key: 'date', label: 'Data', type: 'date' }, { key: 'number', label: 'Número', type: 'text' }, { key: 'client', label: 'Cliente', type: 'text' }, { key: 'seller', label: 'Comercial', type: 'text' }, { key: 'total', label: 'Total', type: 'kz' }],
        rows: inv.map((i) => ({ date: i.issuedAt!.toISOString(), number: i.number, client: cn.get(i.clientId) ?? '-', seller: un.get(i.sellerId ?? '') ?? '-', total: i.total })),
        totals: { total: sumBy(inv, (i) => i.total) },
      },
    ],
  };
}

async function clientsReport(f: Filters): Promise<ReportData> {
  const clients = await prisma.client.findMany({ where: { deletedAt: null, ...(f.userId && { ownerId: f.userId }), ...(f.businessLineId && { businessLines: { some: { id: f.businessLineId } } }) }, include: { owner: { select: { name: true } } } });
  const ids = clients.map((c) => c.id);
  const [inv, rec, last] = await Promise.all([
    prisma.invoice.groupBy({ by: ['clientId'], where: { status: 'ISSUED', clientId: { in: ids }, issuedAt: { gte: f.from, lte: f.to } }, _sum: { total: true } }),
    prisma.receivable.findMany({ where: { deletedAt: null, clientId: { in: ids } } }),
    prisma.timelineEvent.groupBy({ by: ['clientId'], where: { clientId: { in: ids } }, _max: { occurredAt: true } }),
  ]);
  const rows = clients.map((c) => {
    const r = rec.filter((x) => x.clientId === c.id);
    return {
      name: c.name,
      owner: c.owner?.name ?? '-',
      invoiced: inv.find((i) => i.clientId === c.id)?._sum.total ?? 0,
      open: sumBy(r, (x) => x.amount - x.paid),
      overdue: sumBy(r.filter((x) => receivableStatus(x) === 'OVERDUE'), (x) => x.amount - x.paid),
      last: last.find((l) => l.clientId === c.id)?._max.occurredAt?.toISOString() ?? null,
    };
  }).sort((a, b) => b.invoiced - a.invoiced);
  return {
    title: 'Relatório de clientes',
    subtitle: sub(f),
    sections: [{
      title: 'Clientes',
      columns: [{ key: 'name', label: 'Cliente', type: 'text' }, { key: 'owner', label: 'Comercial', type: 'text' }, { key: 'invoiced', label: 'Facturado (período)', type: 'kz' }, { key: 'open', label: 'Em aberto', type: 'kz' }, { key: 'overdue', label: 'Em atraso', type: 'kz' }, { key: 'last', label: 'Última interacção', type: 'date' }],
      rows,
      totals: { invoiced: sumBy(rows, (r) => r.invoiced), open: sumBy(rows, (r) => r.open), overdue: sumBy(rows, (r) => r.overdue) },
    }],
  };
}

async function financeReport(f: Filters): Promise<ReportData> {
  const entries = await prisma.financialEntry.findMany({ where: { deletedAt: null, date: { gte: f.from, lte: f.to }, ...(f.businessLineId && { businessLineId: f.businessLineId }) }, include: { category: true } });
  const by = new Map<string, { type: string; name: string; total: number }>();
  for (const e of entries) {
    const k = `${e.type}:${e.category.name}`;
    const g = by.get(k) ?? { type: e.type === 'INCOME' ? 'Receita' : 'Despesa', name: e.category.name, total: 0 };
    g.total += e.amount;
    by.set(k, g);
  }
  const income = sumBy(entries.filter((e) => e.type === 'INCOME'), (e) => e.amount);
  const expense = sumBy(entries.filter((e) => e.type === 'EXPENSE'), (e) => e.amount);
  const rec = (await prisma.receivable.findMany({ where: { deletedAt: null } })).filter((r) => r.paid < r.amount);
  return {
    title: 'Relatório financeiro',
    subtitle: sub(f),
    sections: [
      { title: 'Resumo', columns: [{ key: 'name', label: '', type: 'text' }, { key: 'value', label: 'Valor', type: 'kz' }], rows: [{ name: 'Receitas', value: income }, { name: 'Despesas', value: expense }, { name: 'Resultado', value: income - expense }, { name: 'Contas a receber em aberto', value: sumBy(rec, (r) => r.amount - r.paid) }] },
      { title: 'Por categoria', columns: [{ key: 'type', label: 'Tipo', type: 'text' }, { key: 'name', label: 'Categoria', type: 'text' }, { key: 'total', label: 'Total', type: 'kz' }], rows: [...by.values()].sort((a, b) => a.type.localeCompare(b.type) || b.total - a.total) },
    ],
  };
}

async function commissionsReport(f: Filters): Promise<ReportData> {
  const periods: string[] = [];
  for (let d = new Date(Date.UTC(f.from.getUTCFullYear(), f.from.getUTCMonth(), 1)); d <= f.to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) periods.push(d.toISOString().slice(0, 7));
  const cs = await prisma.commission.findMany({ where: { period: { in: periods }, ...(f.userId && { userId: f.userId }) } });
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const by = new Map<string, { name: string; base: number; amount: number; approved: number; paid: number }>();
  for (const c of cs) {
    const g = by.get(c.userId) ?? { name: users.get(c.userId) ?? '-', base: 0, amount: 0, approved: 0, paid: 0 };
    g.base += c.baseAmount;
    g.amount += c.amount;
    if (c.status !== 'CALCULATED') g.approved += c.amount;
    if (c.status === 'PAID') g.paid += c.amount;
    by.set(c.userId, g);
  }
  const rows = [...by.values()].sort((a, b) => b.amount - a.amount);
  return {
    title: 'Comissões por comercial',
    subtitle: `${periods.join(', ')}`,
    sections: [{
      title: 'Comissões',
      columns: [{ key: 'name', label: 'Comercial', type: 'text' }, { key: 'base', label: 'Base', type: 'kz' }, { key: 'amount', label: 'Comissão', type: 'kz' }, { key: 'approved', label: 'Aprovada', type: 'kz' }, { key: 'paid', label: 'Paga', type: 'kz' }],
      rows,
      totals: { base: sumBy(rows, (r) => r.base), amount: sumBy(rows, (r) => r.amount), approved: sumBy(rows, (r) => r.approved), paid: sumBy(rows, (r) => r.paid) },
    }],
  };
}

async function stockReport(f: Filters): Promise<ReportData> {
  const items = await prisma.stockItem.findMany({ where: { deletedAt: null, active: true }, include: { levels: true }, orderBy: { code: 'asc' } });
  const mov = await prisma.stockMovement.groupBy({ by: ['itemId', 'type'], where: { createdAt: { gte: f.from, lte: f.to }, type: { in: ['IN', 'OUT'] } }, _sum: { quantity: true } });
  const q = (id: string, t: string) => Number(mov.find((m) => m.itemId === id && m.type === t)?._sum.quantity ?? 0);
  const rows = items.map((i) => {
    const onHand = i.levels.reduce((s, l) => s.plus(l.onHand), D(0)).toNumber();
    const reserved = i.levels.reduce((s, l) => s.plus(l.reserved), D(0)).toNumber();
    return { code: i.code, name: i.name, unit: i.unit, onHand, reserved, available: onHand - reserved, min: Number(i.minStock), in: q(i.id, 'IN'), out: q(i.id, 'OUT'), value: Math.round(onHand * Number(i.avgCost)) };
  });
  return {
    title: 'Relatório de stock',
    subtitle: `Saldos actuais · movimentos de ${sub(f)}`,
    sections: [{
      title: 'Artigos',
      columns: [
        { key: 'code', label: 'Código', type: 'text' }, { key: 'name', label: 'Artigo', type: 'text' }, { key: 'unit', label: 'Un.', type: 'text' },
        { key: 'onHand', label: 'Físico', type: 'num' }, { key: 'reserved', label: 'Reservado', type: 'num' }, { key: 'available', label: 'Disponível', type: 'num' }, { key: 'min', label: 'Mínimo', type: 'num' },
        { key: 'in', label: 'Entradas', type: 'num' }, { key: 'out', label: 'Saídas', type: 'num' }, { key: 'value', label: 'Valor (custo médio)', type: 'kz' },
      ],
      rows,
      totals: { value: sumBy(rows, (r) => r.value) },
    }],
  };
}

// ─── KPIs ───

export async function kpiValues(f: Filters) {
  const range = { gte: f.from, lte: f.to };
  const [tasks, qc, opps, sold, orders, prod] = await Promise.all([
    prisma.task.findMany({ where: { deletedAt: null, status: 'DONE', completedAt: range, ...(f.userId && { assigneeId: f.userId }) } }),
    prisma.stageLog.findMany({ where: { finishedAt: range, stage: { type: 'QUALITY' } } }),
    prisma.opportunity.findMany({ where: { deletedAt: null, closedAt: range, ...(f.userId && { ownerId: f.userId }), ...(f.businessLineId && { businessLineId: f.businessLineId }) }, include: { stage: true } }),
    prisma.invoice.aggregate({ where: { status: 'ISSUED', issuedAt: range, ...(f.userId && { sellerId: f.userId }), ...(f.businessLineId && { businessLineId: f.businessLineId }) }, _sum: { total: true } }),
    prisma.order.findMany({ where: { deletedAt: null, productionOrders: { some: { completedAt: range } } }, include: { productionOrders: { select: { completedAt: true } } } }),
    productivity(f),
  ]);
  const withDue = tasks.filter((t) => t.dueAt);
  const inspected = sumBy(qc, (l) => l.qtyIn);
  const won = opps.filter((o) => o.stage.isWon);
  const doneOrders = orders.filter((o) => o.deadline);
  const onTime = doneOrders.filter((o) => Math.max(...o.productionOrders.map((p) => p.completedAt?.getTime() ?? 0)) <= o.deadline!.getTime() + 86400000);

  const effRows = prod.operators.filter((o) => o.efficiency !== null);
  const values: Record<string, number | null> = {
    tasks_on_time: pct(withDue.filter((t) => t.completedAt! <= t.dueAt!).length, withDue.length),
    tasks_avg_days: tasks.length ? days(sumBy(tasks, (t) => t.completedAt!.getTime() - t.createdAt.getTime()) / tasks.length) : null,
    pieces_per_day: prod.sections.length ? Math.round(sumBy(prod.sections, (s) => s.perDay)) : null,
    efficiency: effRows.length ? Math.round(sumBy(effRows, (o) => o.efficiency! * o.pieces) / sumBy(effRows, (o) => o.pieces)) : null,
    defect_rate: pct(sumBy(qc, (l) => l.qtyRejected + l.qtyRework), inspected),
    rework_rate: pct(sumBy(qc, (l) => l.qtyRework), inspected),
    scrap_rate: pct(sumBy(qc, (l) => l.qtyRejected), inspected),
    conversion: pct(won.length, opps.length),
    sold_value: sold._sum.total ?? 0,
    sales_cycle: won.length ? days(sumBy(won, (o) => o.closedAt!.getTime() - o.createdAt.getTime()) / won.length) : null,
    orders_on_time: pct(onTime.length, doneOrders.length),
  };
  const defs = await prisma.kpiDefinition.findMany({ where: { active: true }, include: { targets: true } });
  return defs.map((d) => {
    const target = d.targets.find((t) => t.userId === (f.userId ?? null)) ?? d.targets.find((t) => t.userId === null);
    const value = values[d.key] ?? null;
    const t = target ? Number(target.value) : null;
    return { key: d.key, name: d.name, unit: d.unit, higher: d.higher, value, target: t, ok: value === null || t === null ? null : d.higher ? value >= t : value <= t };
  });
}

async function performanceReport(f: Filters): Promise<ReportData> {
  const k = await kpiValues(f);
  return {
    title: 'Relatório de desempenho (KPIs)',
    subtitle: sub(f),
    sections: [{
      title: 'Indicadores',
      columns: [{ key: 'name', label: 'Indicador', type: 'text' }, { key: 'value', label: 'Valor', type: 'num' }, { key: 'unit', label: 'Unidade', type: 'text' }, { key: 'target', label: 'Meta', type: 'num' }, { key: 'state', label: 'Estado', type: 'text' }],
      rows: k.map((x) => ({ name: x.name, value: x.value, unit: x.unit, target: x.target, state: x.ok === null ? '-' : x.ok ? 'Cumprida' : 'Abaixo' })),
    }],
  };
}

export const REPORTS = {
  sales: { label: 'Vendas', build: salesReport },
  clients: { label: 'Clientes', build: clientsReport },
  production: { label: 'Produção e produtividade', build: productionReport },
  stock: { label: 'Stock', build: stockReport },
  performance: { label: 'Desempenho (KPIs)', build: performanceReport },
  finance: { label: 'Financeiro', build: financeReport },
  commissions: { label: 'Comissões', build: commissionsReport },
} as const;
export type ReportType = keyof typeof REPORTS;
