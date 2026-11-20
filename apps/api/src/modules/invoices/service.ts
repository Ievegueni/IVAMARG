import { formatKz, type ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import { UnrecoverableError, type Job } from 'bullmq';
import { ensureClient, ensureProduct, vendus, VendusNotConfigured } from '../../integrations/vendus';
import { queue } from '../../jobs/queues';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { seesAll } from '../../lib/scope';
import { getSetting } from '../../lib/settings';
import { addTimeline } from '../../lib/timeline';
import type { PublicUser } from '../users/service';

export type InvoiceItem = { description: string; quantity: number; unitPrice: number; productModelId?: string | null };
type Source = 'Order' | 'Proposal' | 'Contract';

export async function listInvoices(u: PublicUser, q: ListQuery & { clientId?: string; orderId?: string; status?: string }) {
  // Sem finance.viewAll: facturas dos clientes da sua carteira ou pedidas por si.
  const own = seesAll(u, 'finance')
    ? {}
    : { OR: [{ createdById: u.id }, { clientId: { in: (await prisma.client.findMany({ where: { ownerId: u.id }, select: { id: true } })).map((c) => c.id) } }] };
  const where: Prisma.InvoiceWhereInput = {
    ...own,
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.orderId && { orderId: q.orderId }),
    ...(q.status && { status: q.status as never }),
  };
  const [items, total] = await Promise.all([prisma.invoice.findMany({ where, ...pageArgs(q, ['createdAt', 'total'], { createdAt: 'desc' }) }), prisma.invoice.count({ where })]);
  const clients = new Map((await prisma.client.findMany({ where: { id: { in: items.map((i) => i.clientId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return pageResult(items.map((i) => ({ ...i, clientName: clients.get(i.clientId) })), total, q);
}

/** Linhas a facturar a partir da origem (encomenda pronta/entregue, proposta aceite, contrato activo = 1 período). */
async function itemsFrom(source: Source, id: string) {
  if (source === 'Order') {
    const o = await prisma.order.findFirst({ where: { id, deletedAt: null }, include: { lines: { orderBy: { position: 'asc' } }, proposal: true, client: true } });
    if (!o) throw notFound('Encomenda');
    if (!['READY', 'DELIVERED'].includes(o.status)) throw new AppError(409, 'NOT_READY', 'Só encomendas prontas ou entregues podem ser facturadas');
    // Encomendas são da fábrica de uniformes; comercial = dono da proposta ou do cliente.
    const line = o.proposal?.businessLineId ?? (await prisma.businessLine.findFirst({ where: { kind: 'UNIFORMS' } }))?.id ?? null;
    return { clientId: o.clientId, businessLineId: line, sellerId: o.proposal?.ownerId ?? o.client.ownerId, label: `Encomenda ${o.number}`, ref: { orderId: o.id }, items: o.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, productModelId: l.productModelId })) };
  }
  if (source === 'Proposal') {
    const p = await prisma.proposal.findFirst({ where: { id, deletedAt: null }, include: { versions: { include: { items: { orderBy: { position: 'asc' } } } } } });
    if (!p) throw notFound('Proposta');
    if (p.status !== 'ACCEPTED') throw new AppError(409, 'NOT_ACCEPTED', 'Só propostas aceites podem ser facturadas');
    const v = p.versions.find((x) => x.version === p.currentVersion)!;
    // Preço unitário já com desconto (o total da linha é o que conta).
    return { clientId: p.clientId, businessLineId: p.businessLineId, sellerId: p.ownerId, label: `Proposta ${p.number}`, ref: { proposalId: p.id }, items: v.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Math.round(i.total / Number(i.quantity)) })) };
  }
  const c = await prisma.contract.findFirst({ where: { id, deletedAt: null }, include: { client: true } });
  if (!c) throw notFound('Contrato');
  if (c.status !== 'ACTIVE') throw new AppError(409, 'NOT_ACTIVE', 'Contrato não activo');
  return { clientId: c.clientId, businessLineId: c.businessLineId, sellerId: c.client.ownerId, label: `Contrato ${c.number}`, ref: { contractId: c.id }, items: [{ description: c.title, quantity: 1, unitPrice: c.value }] };
}

export async function requestInvoice(ctx: Ctx, u: PublicUser, source: Source, sourceId: string, dueDate?: Date | null) {
  const src = await itemsFrom(source, sourceId);
  // Encomendas e propostas facturam-se uma vez; contratos uma vez por período (sem bloqueio).
  if (source !== 'Contract') {
    const dup = await prisma.invoice.findFirst({ where: { ...src.ref, status: { in: ['PENDING', 'ISSUED'] } } });
    if (dup) throw new AppError(409, 'ALREADY_INVOICED', `${src.label} já tem factura ${dup.number ?? '(em emissão)'}`);
  }
  const total = src.items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
  const inv = await prisma.invoice.create({
    data: { ...src.ref, clientId: src.clientId, businessLineId: src.businessLineId, sellerId: src.sellerId, total, dueDate, items: src.items, documentType: await getSetting('vendus.documentType', 'FT'), createdById: u.id },
  });
  await audit(ctx, { entity: 'Invoice', entityId: inv.id, action: 'request', after: inv });
  await queue('vendus').add('issue-invoice', { invoiceId: inv.id }, { jobId: `invoice-${inv.id}-${Date.now()}` });
  return inv;
}

export async function retryInvoice(ctx: Ctx, id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Factura');
  if (inv.status !== 'FAILED') throw new AppError(409, 'INVALID_STATUS', 'Só facturas com falha podem ser reenviadas');
  await prisma.invoice.update({ where: { id }, data: { status: 'PENDING', error: null } });
  await audit(ctx, { entity: 'Invoice', entityId: id, action: 'retry' });
  await queue('vendus').add('issue-invoice', { invoiceId: id }, { jobId: `invoice-${id}-${Date.now()}` });
  return { ok: true };
}

/** Worker da fila `vendus`: emite o documento. Erros temporários → retry com backoff; falha final → FAILED + notificação. */
export async function processVendus(job: Job<{ invoiceId: string }>) {
  if (job.name !== 'issue-invoice') return;
  const inv = await prisma.invoice.findUnique({ where: { id: job.data.invoiceId } });
  if (!inv || inv.status !== 'PENDING') return; // já tratada
  try {
    const clientRef = await ensureClient(inv.clientId);
    const items = await Promise.all(
      (inv.items as InvoiceItem[]).map(async (i) => ({
        ...(i.productModelId && { id: await ensureProduct(i.productModelId) }),
        title: i.description,
        qty: i.quantity,
        gross_price: i.unitPrice,
      })),
    );
    const doc = await vendus<{ id: number | string; number: string }>('POST', 'documents', {
      type: inv.documentType,
      mode: await getSetting('vendus.mode', 'tests'),
      client: { id: clientRef },
      items,
      ...(inv.dueDate && { date_due: inv.dueDate.toISOString().slice(0, 10) }),
      external_reference: inv.id,
    });
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'ISSUED', vendusDocumentId: String(doc.id), number: doc.number, issuedAt: new Date(), error: null } });
      // Conta a receber nasce com a factura.
      await tx.receivable.create({ data: { clientId: inv.clientId, invoiceId: inv.id, description: `Factura ${doc.number}`, amount: inv.total, dueDate: inv.dueDate, businessLineId: inv.businessLineId } });
      await addTimeline(tx, { clientId: inv.clientId, title: `Factura ${doc.number} emitida (${formatKz(inv.total)})`, entity: 'Invoice', entityId: inv.id, userId: inv.createdById ?? undefined });
    });
    if (inv.createdById) await notify([inv.createdById], { title: `Factura ${doc.number} emitida`, body: formatKz(inv.total), link: '/facturas' });
    return { number: doc.number };
  } catch (err) {
    const final = err instanceof VendusNotConfigured || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (final) {
      await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'FAILED', error: String((err as Error).message).slice(0, 500) } });
      if (inv.createdById) await notify([inv.createdById], { title: 'Falha na emissão de factura', body: (err as Error).message, link: '/facturas' });
    }
    if (err instanceof VendusNotConfigured) throw new UnrecoverableError(err.message);
    throw err;
  }
}
