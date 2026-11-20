import { formatKz, hasPermission, lineTotal, needsApproval, proposalCreateSchema, proposalVersionSchema, type ListQuery, type ProposalStatus } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { notify, usersWithPermission } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { assertOwner, ownerFilter } from '../../lib/scope';
import { nextNumber } from '../../lib/sequence';
import { getSetting } from '../../lib/settings';
import { addTimeline } from '../../lib/timeline';
import { getClient } from '../clients/service';
import { emitAutomation } from '../communication/automations';
import { moveTx } from '../opportunities/service';
import { defaultPhases } from '../operations/service';
import type { PublicUser } from '../users/service';

type VersionData = z.output<typeof proposalVersionSchema>;
type Tx = Prisma.TransactionClient;

const versionInclude = {
  items: { orderBy: { position: 'asc' as const } },
  approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
};
const include = {
  client: { select: { id: true, name: true, nif: true, address: true, email: true, phones: true } },
  owner: { select: { id: true, name: true } },
  businessLine: { select: { id: true, name: true, kind: true } },
  opportunity: { select: { id: true, title: true } },
  versions: { include: versionInclude, orderBy: { version: 'desc' as const } },
  order: { select: { id: true, number: true } },
  contract: { select: { id: true, number: true } },
  project: { select: { id: true, number: true } },
  borehole: { select: { id: true, number: true } },
};

export async function listProposals(user: PublicUser, q: ListQuery & { status?: ProposalStatus; clientId?: string }) {
  const where: Prisma.ProposalWhereInput = {
    deletedAt: null,
    ...ownerFilter(user, 'pipeline'),
    ...(q.status && { status: q.status }),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.search && {
      OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }, { client: { name: { contains: q.search, mode: 'insensitive' } } }],
    }),
  };
  const [items, total] = await Promise.all([
    prisma.proposal.findMany({
      where,
      include: { client: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } }, businessLine: { select: { name: true } } },
      ...pageArgs(q, ['number', 'total', 'createdAt', 'updatedAt'], { updatedAt: 'desc' }),
    }),
    prisma.proposal.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function getProposal(user: PublicUser, id: string) {
  const p = await prisma.proposal.findFirst({ where: { id, deletedAt: null }, include });
  if (!p) throw notFound('Proposta');
  // O aprovador vê a proposta que tem de aprovar, mesmo fora da sua carteira.
  if (!(p.status === 'PENDING_APPROVAL' && hasPermission(user, 'pipeline.approve'))) assertOwner(user, 'pipeline', p.ownerId);
  return { ...p, approvalThreshold: await getSetting('proposals.approvalThreshold', 0) };
}
type FullProposal = Awaited<ReturnType<typeof getProposal>>;
const current = (p: FullProposal) => p.versions.find((v) => v.version === p.currentVersion)!;

function itemsData(items: VersionData['items']) {
  const rows = items.map((it, i) => ({ ...it, position: i + 1, total: lineTotal(it.quantity, it.unitPrice, it.discountPct) }));
  return { rows, total: rows.reduce((s, r) => s + r.total, 0) };
}

function assertStatus(p: { status: ProposalStatus }, allowed: ProposalStatus[], action: string) {
  if (!allowed.includes(p.status)) throw new AppError(409, 'INVALID_STATUS', `Não é possível ${action} uma proposta neste estado`);
}

export async function createProposal(ctx: Ctx, user: PublicUser, d: z.output<typeof proposalCreateSchema>) {
  await getClient(user, d.clientId);
  const { rows, total } = itemsData(d.items);
  const id = await prisma.$transaction(async (tx) => {
    const p = await tx.proposal.create({
      data: {
        number: await nextNumber(tx, 'PROP'),
        title: d.title,
        clientId: d.clientId,
        businessLineId: d.businessLineId,
        opportunityId: d.opportunityId,
        mode: d.mode,
        ownerId: user.id,
        total,
        createdById: user.id,
        versions: { create: { version: 1, notes: d.notes, validUntil: d.validUntil, total, createdById: user.id, items: { create: rows } } },
      },
    });
    await addTimeline(tx, { clientId: d.clientId, title: `Proposta ${p.number} criada (${formatKz(total)})`, userId: user.id, entity: 'Proposal', entityId: p.id });
    await audit(ctx, { entity: 'Proposal', entityId: p.id, action: 'create', after: { ...p, items: rows } }, tx);
    return p.id;
  });
  return getProposal(user, id);
}

/** Edita a versão actual. Só enquanto não foi enviada (DRAFT ou REJECTED → volta a DRAFT). */
export async function updateDraft(ctx: Ctx, user: PublicUser, id: string, d: VersionData & { title?: string }) {
  const p = await getProposal(user, id);
  assertStatus(p, ['DRAFT', 'REJECTED'], 'editar');
  const v = current(p);
  const { rows, total } = itemsData(d.items);
  await prisma.$transaction(async (tx) => {
    await tx.proposalItem.deleteMany({ where: { versionId: v.id } });
    await tx.proposalVersion.update({ where: { id: v.id }, data: { notes: d.notes, validUntil: d.validUntil, total, items: { create: rows } } });
    await tx.proposal.update({ where: { id }, data: { total, status: 'DRAFT', ...(d.title && { title: d.title }) } });
    await audit(ctx, { entity: 'Proposal', entityId: id, action: 'update', before: v, after: { ...d, total } }, tx);
  });
  return getProposal(user, id);
}

export async function submitForApproval(ctx: Ctx, user: PublicUser, id: string) {
  const p = await getProposal(user, id);
  assertStatus(p, ['DRAFT'], 'submeter');
  const status: ProposalStatus = needsApproval(p.total, p.approvalThreshold) ? 'PENDING_APPROVAL' : 'APPROVED';
  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id }, data: { status } });
    await audit(ctx, { entity: 'Proposal', entityId: id, action: 'submit', after: { status, total: p.total } }, tx);
  });
  if (status === 'PENDING_APPROVAL') {
    const approvers = (await usersWithPermission('pipeline.approve')).filter((u) => u !== user.id);
    await notify(approvers, {
      title: `Proposta ${p.number} para aprovar`,
      body: `${p.client.name} - ${formatKz(p.total)} (v${p.currentVersion}), submetida por ${user.name}.`,
      link: `/propostas/${id}`,
    });
  }
  return getProposal(user, id);
}

export async function decide(ctx: Ctx, user: PublicUser, id: string, decision: 'APPROVED' | 'REJECTED', comment?: string | null) {
  const p = await getProposal(user, id);
  assertStatus(p, ['PENDING_APPROVAL'], decision === 'APPROVED' ? 'aprovar' : 'rejeitar');
  if (decision === 'REJECTED' && !comment) throw new AppError(400, 'COMMENT_REQUIRED', 'Indique o motivo da rejeição');
  await prisma.$transaction(async (tx) => {
    await tx.approval.create({ data: { versionId: current(p).id, approverId: user.id, decision, comment } });
    await tx.proposal.update({ where: { id }, data: { status: decision } });
    await audit(ctx, { entity: 'Proposal', entityId: id, action: decision === 'APPROVED' ? 'approve' : 'reject', after: { comment } }, tx);
  });
  if (p.ownerId && p.ownerId !== user.id) {
    await notify([p.ownerId], {
      title: `Proposta ${p.number} ${decision === 'APPROVED' ? 'aprovada' : 'rejeitada'}`,
      body: `${user.name}${comment ? `: ${comment}` : ''}`,
      link: `/propostas/${id}`,
    });
  }
  return getProposal(user, id);
}

/** Envio ao cliente: a versão fica imutável. Exige aprovação se total ≥ limite. */
export async function markSent(ctx: Ctx, user: PublicUser, id: string) {
  const p = await getProposal(user, id);
  assertStatus(p, ['DRAFT', 'APPROVED'], 'enviar');
  if (p.status === 'DRAFT' && needsApproval(p.total, p.approvalThreshold)) {
    throw new AppError(409, 'APPROVAL_REQUIRED', `Total ≥ ${formatKz(p.approvalThreshold)}: submeta para aprovação antes de enviar`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.proposalVersion.update({ where: { id: current(p).id }, data: { sentAt: new Date() } });
    await tx.proposal.update({ where: { id }, data: { status: 'SENT' } });
    await addTimeline(tx, { clientId: p.clientId, title: `Proposta ${p.number} v${p.currentVersion} enviada (${formatKz(p.total)})`, userId: user.id, entity: 'Proposal', entityId: id });
    await audit(ctx, { entity: 'Proposal', entityId: id, action: 'send', after: { version: p.currentVersion } }, tx);
  });
  await emitAutomation('PROPOSAL_SENT', { proposalId: id });
  return getProposal(user, id);
}

/** Nova versão (cópia da actual) depois de enviada/recusada. */
export async function newVersion(ctx: Ctx, user: PublicUser, id: string) {
  const p = await getProposal(user, id);
  assertStatus(p, ['SENT', 'DECLINED'], 'criar nova versão de');
  const v = current(p);
  const version = p.currentVersion + 1;
  await prisma.$transaction(async (tx) => {
    await tx.proposalVersion.create({
      data: {
        proposalId: id,
        version,
        notes: v.notes,
        validUntil: v.validUntil,
        total: v.total,
        createdById: user.id,
        items: { create: v.items.map(({ id: _id, versionId: _v, ...it }) => it) },
      },
    });
    await tx.proposal.update({ where: { id }, data: { currentVersion: version, status: 'DRAFT', declineReason: null } });
    await audit(ctx, { entity: 'Proposal', entityId: id, action: 'new_version', after: { version } }, tx);
  });
  return getProposal(user, id);
}

export async function decline(ctx: Ctx, user: PublicUser, id: string, reason?: string | null) {
  const p = await getProposal(user, id);
  assertStatus(p, ['SENT'], 'marcar como recusada');
  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id }, data: { status: 'DECLINED', declineReason: reason } });
    await addTimeline(tx, { clientId: p.clientId, title: `Proposta ${p.number} recusada pelo cliente`, body: reason, userId: user.id, entity: 'Proposal', entityId: id });
    await audit(ctx, { entity: 'Proposal', entityId: id, action: 'decline', after: { reason } }, tx);
  });
  return getProposal(user, id);
}

/**
 * Aceitação pelo cliente → gera o registo operacional conforme a linha de negócio (CLAUDE.md §5.5):
 * uniformes → Encomenda; obras → Obra; furos → Furo; limpeza → Contrato recorrente.
 */
export async function accept(ctx: Ctx, user: PublicUser, id: string) {
  const p = await getProposal(user, id);
  assertStatus(p, ['SENT'], 'aceitar');
  const v = current(p);
  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    const generated = await convert(tx, p, v, user.id);
    await addTimeline(tx, {
      clientId: p.clientId,
      title: `Proposta ${p.number} aceite → ${generated.label} ${generated.number}`,
      userId: user.id,
      entity: generated.entity,
      entityId: generated.id,
    });
    // Oportunidade ligada passa ao estado "ganho" da linha.
    if (p.opportunityId) {
      const opp = await tx.opportunity.findUnique({ where: { id: p.opportunityId } });
      const won = await tx.pipelineStage.findFirst({ where: { businessLineId: p.businessLineId, isWon: true, active: true }, orderBy: { order: 'asc' } });
      if (opp && won) await moveTx(ctx, user.id, opp, won, null, tx);
    }
    await audit(ctx, { entity: 'Proposal', entityId: id, action: 'accept', after: generated }, tx);
  });
  return getProposal(user, id);
}

async function convert(tx: Tx, p: FullProposal, v: ReturnType<typeof current>, userId: string) {
  const base = { clientId: p.clientId, proposalId: p.id, createdById: userId };
  switch (p.businessLine.kind) {
    case 'UNIFORMS': {
      // A grelha de tamanhos é preenchida depois na encomenda (estado Rascunho).
      const lines = v.items.map((it, i) => {
        const quantity = Math.round(Number(it.quantity));
        const unitPrice = quantity ? Math.round(it.total / quantity) : it.unitPrice;
        return { position: i + 1, description: it.description, quantity, unitPrice, total: quantity * unitPrice };
      });
      const o = await tx.order.create({
        data: { ...base, number: await nextNumber(tx, 'ENC'), notes: `Gerada da proposta ${p.number} v${v.version}`, total: lines.reduce((s, l) => s + l.total, 0), lines: { create: lines } },
      });
      return { entity: 'Order', id: o.id, number: o.number, label: 'Encomenda' };
    }
    case 'CONSTRUCTION': {
      // Proposta em fases → fases da obra com o orçamento de cada uma.
      const phases = await defaultPhases('Project', p.mode === 'PHASES' ? v.items : []);
      const o = await tx.project.create({ data: { ...base, number: await nextNumber(tx, 'OBR'), name: p.title, budget: v.total, phases: { create: phases } } });
      return { entity: 'Project', id: o.id, number: o.number, label: 'Obra' };
    }
    case 'BOREHOLE': {
      const o = await tx.borehole.create({ data: { ...base, number: await nextNumber(tx, 'FUR'), name: p.title, budget: v.total, phases: { create: await defaultPhases('Borehole') } } });
      return { entity: 'Borehole', id: o.id, number: o.number, label: 'Furo' };
    }
    case 'CLEANING': {
      // Valor da proposta = valor por período; periodicidade mensal por defeito, ajustável no contrato.
      const o = await tx.contract.create({
        data: { ...base, number: await nextNumber(tx, 'CTR'), title: p.title, businessLineId: p.businessLineId, startDate: new Date(), value: v.total, periodicity: 'MONTHLY' },
      });
      return { entity: 'Contract', id: o.id, number: o.number, label: 'Contrato' };
    }
  }
}
