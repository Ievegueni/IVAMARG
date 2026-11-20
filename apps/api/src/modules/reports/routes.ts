import { hasPermission } from '@ivamarg/shared';
import type { Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queue } from '../../jobs/queues';
import { audit, ctxOf } from '../../lib/audit';
import { forbidden, notFound } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { prisma } from '../../lib/prisma';
import { getSetting } from '../../lib/settings';
import { putFile, signedUrl } from '../../lib/storage';
import type { PublicUser } from '../users/service';
import { kpiValues, REPORTS, type Filters, type ReportType } from './data';
import { toPdf, toXlsx } from './render';

const filtersSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  businessLineId: z.string().optional().transform((v) => v || undefined),
  userId: z.string().optional().transform((v) => v || undefined),
});

/**
 * Quem pode ver cada relatório. Sem "ver todos" nos relatórios, vendas/clientes/desempenho/comissões
 * ficam limitados aos próprios dados ("os seus", CLAUDE.md §7).
 */
function scoped(u: PublicUser, type: ReportType, f: Filters): Filters {
  const all = hasPermission(u, 'reports.viewAll');
  const need: Record<ReportType, boolean> = {
    sales: hasPermission(u, 'reports.view'),
    clients: hasPermission(u, 'reports.view'),
    performance: hasPermission(u, 'reports.view'),
    commissions: hasPermission(u, 'finance.view'),
    production: hasPermission(u, 'production.view') && hasPermission(u, 'reports.view'),
    stock: hasPermission(u, 'stock.view') && hasPermission(u, 'reports.view'),
    finance: hasPermission(u, 'finance.viewAll'),
  };
  if (!need[type]) throw forbidden();
  const ownOnly = ['sales', 'clients', 'performance', 'commissions'].includes(type) && !all && !(type === 'commissions' && hasPermission(u, 'finance.viewAll'));
  return ownOnly ? { ...f, userId: u.id } : f;
}

export async function reportRoutes(app: FastifyInstance) {
  const view = { preHandler: app.guard() };

  app.get('/types', view, () => Object.entries(REPORTS).map(([k, v]) => ({ type: k, label: v.label })));
  app.get<{ Params: { type: string } }>('/data/:type', view, async (req) => {
    const type = z.enum(Object.keys(REPORTS) as [ReportType]).parse(req.params.type);
    return REPORTS[type].build(scoped(req.currentUser!, type, filtersSchema.parse(req.query)));
  });
  app.get('/kpis', view, async (req) => {
    const f = filtersSchema.parse(req.query);
    return kpiValues(hasPermission(req.currentUser!, 'reports.viewAll') ? f : { ...f, userId: req.currentUser!.id });
  });

  // ── Configuração de KPIs (activos e metas) ──
  app.get('/kpi-definitions', { preHandler: app.guard('backoffice.view') }, () => prisma.kpiDefinition.findMany({ include: { targets: true }, orderBy: { name: 'asc' } }));
  app.patch<{ Params: { key: string } }>('/kpi-definitions/:key', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const after = await prisma.kpiDefinition.update({ where: { key: req.params.key }, data: z.object({ active: z.boolean() }).parse(req.body) });
    await audit(ctxOf(req), { entity: 'KpiDefinition', entityId: after.key, action: 'update', after });
    return after;
  });
  app.put('/kpi-targets', { preHandler: app.guard('backoffice.edit') }, async (req) => {
    const b = z.object({ kpiKey: z.string(), userId: z.string().nullable().default(null), value: z.coerce.number().nullable() }).parse(req.body);
    const existing = await prisma.kpiTarget.findFirst({ where: { kpiKey: b.kpiKey, userId: b.userId } });
    if (b.value === null) {
      if (existing) await prisma.kpiTarget.delete({ where: { id: existing.id } });
    } else if (existing) await prisma.kpiTarget.update({ where: { id: existing.id }, data: { value: b.value } });
    else await prisma.kpiTarget.create({ data: { kpiKey: b.kpiKey, userId: b.userId, value: b.value } });
    await audit(ctxOf(req), { entity: 'KpiTarget', entityId: b.kpiKey, action: 'set', after: b });
    return { ok: true };
  });

  /** Exportação PDF/Excel via fila (relatórios pesados não bloqueiam a API). */
  app.post('/export', { preHandler: app.guard('reports.export') }, async (req) => {
    const b = z.object({ type: z.enum(Object.keys(REPORTS) as [ReportType]), format: z.enum(['pdf', 'xlsx']), filters: filtersSchema }).parse(req.body);
    const filters = scoped(req.currentUser!, b.type, b.filters);
    const r = await prisma.report.create({ data: { type: b.type, format: b.format, filters, userId: req.currentUser!.id } });
    await audit(ctxOf(req), { entity: 'Report', entityId: r.id, action: 'export', after: b });
    await queue('reports').add('generate', { reportId: r.id });
    return r;
  });
  app.get('/exports', view, (req) => prisma.report.findMany({ where: { userId: req.currentUser!.id }, orderBy: { createdAt: 'desc' }, take: 20 }));
  app.get<{ Params: { id: string } }>('/exports/:id/url', view, async (req) => {
    const r = await prisma.report.findFirst({ where: { id: req.params.id, userId: req.currentUser!.id, status: 'READY' } });
    if (!r?.storageKey) throw notFound('Relatório');
    return { url: signedUrl(r.storageKey, 300, r.filename ?? undefined) };
  });
}

/** Worker da fila `reports`. */
export async function processReport(job: Job<{ reportId: string }>) {
  const r = await prisma.report.findUnique({ where: { id: job.data.reportId } });
  if (!r || r.status !== 'PENDING') return;
  try {
    const f = r.filters as unknown as { from: string; to: string; businessLineId?: string; userId?: string };
    const data = await REPORTS[r.type as ReportType].build({ ...f, from: new Date(f.from), to: new Date(f.to) });
    const buf = r.format === 'pdf' ? await toPdf(data, await getSetting('company.name', 'Ivamarg')) : await toXlsx(data);
    const filename = `${r.type}-${f.from.slice(0, 10)}_${f.to.slice(0, 10)}.${r.format}`;
    const key = await putFile(buf, 'reports', filename);
    await prisma.report.update({ where: { id: r.id }, data: { status: 'READY', storageKey: key, filename } });
    await notify([r.userId], { title: `Relatório pronto: ${REPORTS[r.type as ReportType].label}`, body: filename, link: '/relatorios' });
  } catch (err) {
    await prisma.report.update({ where: { id: r.id }, data: { status: 'FAILED', error: String(err).slice(0, 300) } });
    throw err;
  }
}
