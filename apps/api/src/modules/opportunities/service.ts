import { opportunitySchema } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { assertOwner, ownerFilter, seesAll } from '../../lib/scope';
import { addTimeline } from '../../lib/timeline';
import { getClient } from '../clients/service';
import type { PublicUser } from '../users/service';

type OppData = z.output<typeof opportunitySchema>;
const include = {
  client: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  stage: true,
};

export function listOpportunities(user: PublicUser, q: { businessLineId?: string; clientId?: string; ownerId?: string }) {
  const where: Prisma.OpportunityWhereInput = {
    deletedAt: null,
    ...ownerFilter(user, 'pipeline'),
    ...(q.businessLineId && { businessLineId: q.businessLineId }),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.ownerId && seesAll(user, 'pipeline') && { ownerId: q.ownerId }),
  };
  // ponytail: kanban sem paginação; limitar/arquivar fechadas antigas se passar de algumas centenas.
  return prisma.opportunity.findMany({ where, include, orderBy: { updatedAt: 'desc' }, take: 500 });
}

export async function getOpportunity(user: PublicUser, id: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!opp) throw notFound('Oportunidade');
  assertOwner(user, 'pipeline', opp.ownerId);
  return opp;
}

async function stageOf(businessLineId: string, stageId?: string) {
  const stage = stageId
    ? await prisma.pipelineStage.findFirst({ where: { id: stageId, businessLineId, active: true } })
    : await prisma.pipelineStage.findFirst({ where: { businessLineId, active: true }, orderBy: { order: 'asc' } });
  if (!stage) throw new AppError(400, 'INVALID_STAGE', 'Estado do funil inválido para esta linha de negócio');
  return stage;
}

export async function createOpportunity(ctx: Ctx, user: PublicUser, d: OppData) {
  await getClient(user, d.clientId); // valida acesso ao cliente
  const stage = await stageOf(d.businessLineId, d.stageId);
  if (stage.isLost) throw new AppError(400, 'INVALID_STAGE', 'Não pode criar uma oportunidade já perdida');
  const ownerId = seesAll(user, 'pipeline') ? (d.ownerId ?? user.id) : user.id;
  return prisma.$transaction(async (tx) => {
    const opp = await tx.opportunity.create({
      data: { ...d, stageId: stage.id, ownerId, createdById: user.id, closedAt: stage.isWon ? new Date() : null },
      include,
    });
    await addTimeline(tx, { clientId: d.clientId, title: `Oportunidade criada: ${d.title}`, userId: user.id, entity: 'Opportunity', entityId: opp.id });
    await audit(ctx, { entity: 'Opportunity', entityId: opp.id, action: 'create', after: opp }, tx);
    return opp;
  });
}

export async function updateOpportunity(ctx: Ctx, user: PublicUser, id: string, d: Partial<OppData>) {
  const before = await getOpportunity(user, id);
  if (!seesAll(user, 'pipeline')) delete d.ownerId;
  delete d.stageId; // mudança de estado só via moveOpportunity (motivo de perda)
  if (d.businessLineId && d.businessLineId !== before.businessLineId) {
    throw new AppError(400, 'LINE_LOCKED', 'Não é possível mudar a linha de negócio de uma oportunidade');
  }
  return prisma.$transaction(async (tx) => {
    const after = await tx.opportunity.update({ where: { id }, data: d, include });
    await audit(ctx, { entity: 'Opportunity', entityId: id, action: 'update', before, after }, tx);
    return after;
  });
}

/** Mudar de estado no kanban. "Perdido" exige motivo (CLAUDE.md §5.4). */
export async function moveOpportunity(ctx: Ctx, user: PublicUser, id: string, stageId: string, lostReason?: string | null) {
  const before = await getOpportunity(user, id);
  const stage = await stageOf(before.businessLineId, stageId);
  if (stage.isLost && !lostReason) throw new AppError(400, 'LOST_REASON_REQUIRED', 'Indique o motivo da perda');
  return moveTx(ctx, user.id, before, stage, lostReason);
}

export async function moveTx(
  ctx: Ctx,
  userId: string,
  before: { id: string; clientId: string; title: string; stageId: string },
  stage: { id: string; name: string; isWon: boolean; isLost: boolean },
  lostReason?: string | null,
  tx?: Prisma.TransactionClient,
) {
  if (before.stageId === stage.id) return prisma.opportunity.findUniqueOrThrow({ where: { id: before.id }, include });
  const run = async (t: Prisma.TransactionClient) => {
    const after = await t.opportunity.update({
      where: { id: before.id },
      data: {
        stageId: stage.id,
        lostReason: stage.isLost ? lostReason : null,
        closedAt: stage.isWon || stage.isLost ? new Date() : null,
      },
      include,
    });
    await addTimeline(t, {
      clientId: before.clientId,
      title: `Oportunidade "${before.title}" → ${stage.name}`,
      body: stage.isLost ? `Motivo: ${lostReason}` : null,
      userId,
      entity: 'Opportunity',
      entityId: before.id,
    });
    await audit(ctx, { entity: 'Opportunity', entityId: before.id, action: 'move', before, after }, t);
    return after;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}
