import { TIMEZONE } from '@ivamarg/shared';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { getSetting } from '../../lib/settings';
import { addTimeline } from '../../lib/timeline';

/**
 * Datas das visitas: dias da semana (1=seg … 7=dom) às HH:MM de Luanda, durante N semanas a partir de `from`.
 * Luanda = UTC+1 sem horário de verão.
 */
export function visitDates(days: number[], time: string, weeks: number, from: Date) {
  const [h, m] = time.split(':').map(Number);
  const startDay = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(from)}T00:00:00Z`);
  const out: Date[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startDay.getTime() + i * 86400000);
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (!days.includes(dow)) continue;
    const at = new Date(d.getTime() + (h - 1) * 3600_000 + m * 60_000); // HH:MM Luanda → UTC
    if (at > from) out.push(at);
  }
  return out;
}

/** Guarda o plano no contrato e cria as visitas que ainda não existem (idempotente). */
export async function planVisits(ctx: Ctx, contractId: string, d: { visitDays: number[]; visitTime: string; visitTeam?: string | null; weeks: number }) {
  const c = await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null } });
  if (!c) throw notFound('Contrato');
  if (c.status !== 'ACTIVE') throw new AppError(409, 'NOT_ACTIVE', 'Contrato não activo');
  const checklist = (await getSetting<string[]>('cleaning.checklist', [])).map((item) => ({ item, done: false }));
  let dates = visitDates(d.visitDays, d.visitTime, d.weeks, new Date());
  if (c.endDate) dates = dates.filter((x) => x <= new Date(c.endDate!.getTime() + 86400000));
  const r = await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id: c.id }, data: { visitDays: d.visitDays, visitTime: d.visitTime, visitTeam: d.visitTeam } });
    const created = await tx.serviceVisit.createMany({ data: dates.map((scheduledAt) => ({ contractId: c.id, scheduledAt, team: d.visitTeam, checklist })), skipDuplicates: true });
    await audit(ctx, { entity: 'Contract', entityId: c.id, action: 'plan_visits', after: { ...d, created: created.count } }, tx);
    return created.count;
  });
  return { created: r };
}

export async function updateVisit(ctx: Ctx, id: string, d: { status?: string; notes?: string | null; team?: string | null; scheduledAt?: Date; checklist?: { item: string; done: boolean }[] }) {
  const before = await prisma.serviceVisit.findUnique({ where: { id }, include: { contract: true } });
  if (!before) throw notFound('Visita');
  const after = await prisma.serviceVisit.update({
    where: { id },
    data: { ...d, ...(d.status === 'DONE' && before.status !== 'DONE' && { executedAt: new Date(), userId: ctx.userId }) },
  });
  if (d.status && d.status !== before.status && ['DONE', 'MISSED'].includes(d.status)) {
    await prisma.$transaction((tx) =>
      addTimeline(tx, { clientId: before.contract.clientId, type: 'VISIT', title: `Visita ${d.status === 'DONE' ? 'realizada' : 'falhada'} (${before.contract.number})`, body: d.notes ?? null, userId: ctx.userId, entity: 'ServiceVisit', entityId: id }),
    );
  }
  await audit(ctx, { entity: 'ServiceVisit', entityId: id, action: 'update', before, after });
  return after;
}
