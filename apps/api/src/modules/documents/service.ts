import { documentMetaSchema, hasPermission, type ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { clientIdOf } from '../../lib/clientOf';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { putFile, signedUrl } from '../../lib/storage';
import { addTimeline } from '../../lib/timeline';
import { getClient } from '../clients/service';
import type { PublicUser } from '../users/service';

type Meta = z.output<typeof documentMetaSchema>;
export type Upload = { buffer: Buffer; filename: string; mime: string };

/** Categorias que o utilizador pode ver (vazio em roleIds = todos). */
export const categoryFilter = (u: PublicUser): Prisma.DocumentCategoryWhereInput =>
  u.isAdmin ? {} : { OR: [{ roleIds: { isEmpty: true } }, { roleIds: { has: u.role.id } }] };

const include = {
  category: { select: { id: true, name: true } },
  folder: { select: { id: true, name: true } },
  links: true,
  versions: { orderBy: { version: 'desc' as const }, select: { id: true, version: true, filename: true, mime: true, size: true, createdAt: true, uploadedById: true } },
};

export async function listDocuments(u: PublicUser, q: ListQuery & { categoryId?: string; folderId?: string; entity?: string; entityId?: string; expiring?: number; tag?: string }) {
  const soon = q.expiring !== undefined ? new Date(Date.now() + q.expiring * 86400000) : null;
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    category: categoryFilter(u),
    ...(q.categoryId && { categoryId: q.categoryId }),
    ...(q.folderId && { folderId: q.folderId }),
    ...(q.tag && { tags: { has: q.tag } }),
    ...(q.entity && q.entityId && { links: { some: { entity: q.entity, entityId: q.entityId } } }),
    ...(soon && { expiresAt: { lte: soon } }),
    ...(q.search && { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }, { tags: { has: q.search.toLowerCase() } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.document.findMany({ where, include, ...pageArgs(q, ['title', 'createdAt', 'expiresAt', 'issuedAt'], soon ? { expiresAt: 'asc' } : { createdAt: 'desc' }) }),
    prisma.document.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function getDocument(u: PublicUser, id: string) {
  const d = await prisma.document.findFirst({ where: { id, deletedAt: null }, include: { ...include, category: true } });
  if (!d) throw notFound('Documento');
  if (!u.isAdmin && d.category.roleIds.length && !d.category.roleIds.includes(u.role.id)) throw forbidden();
  return d;
}

/** Edita quem tem documents.edit ou quem criou o documento (com documents.create). */
function assertCanEdit(u: PublicUser, d: { createdById: string | null }) {
  if (hasPermission(u, 'documents.edit') || (d.createdById === u.id && hasPermission(u, 'documents.create'))) return;
  throw forbidden();
}

async function assertCategory(u: PublicUser, categoryId: string) {
  const c = await prisma.documentCategory.findFirst({ where: { id: categoryId, active: true, ...categoryFilter(u) } });
  if (!c) throw new AppError(400, 'INVALID_CATEGORY', 'Categoria inválida ou sem permissão');
}

/** Só se pode ligar documentos a clientes a que se tem acesso (carteira). */
async function assertLinks(u: PublicUser, links: Meta['links']) {
  for (const l of links) if (l.entity === 'Client') await getClient(u, l.entityId);
}

async function linkTimeline(tx: Prisma.TransactionClient, links: Meta['links'], title: string, docId: string, userId: string) {
  for (const l of links) {
    const clientId = await clientIdOf(l.entity, l.entityId);
    if (clientId) await addTimeline(tx, { clientId, title, userId, entity: 'Document', entityId: docId });
  }
}

export async function createDocument(ctx: Ctx, u: PublicUser, meta: Meta, file: Upload) {
  await assertCategory(u, meta.categoryId);
  await assertLinks(u, meta.links);
  const key = await putFile(file.buffer, 'documents', file.filename);
  const { links, ...rest } = meta;
  return prisma.$transaction(async (tx) => {
    const d = await tx.document.create({
      data: {
        ...rest,
        tags: rest.tags.map((t) => t.toLowerCase()),
        createdById: u.id,
        versions: { create: { version: 1, storageKey: key, filename: file.filename, mime: file.mime, size: file.buffer.length, uploadedById: u.id } },
        links: { create: links },
      },
      include,
    });
    await linkTimeline(tx, links, `Documento: ${d.title}`, d.id, u.id);
    await audit(ctx, { entity: 'Document', entityId: d.id, action: 'upload', after: { ...meta, filename: file.filename, size: file.buffer.length } }, tx);
    return d;
  });
}

export async function addVersion(ctx: Ctx, u: PublicUser, id: string, file: Upload) {
  const d = await getDocument(u, id);
  assertCanEdit(u, d);
  const key = await putFile(file.buffer, 'documents', file.filename);
  const version = d.currentVersion + 1;
  return prisma.$transaction(async (tx) => {
    await tx.documentVersion.create({ data: { documentId: id, version, storageKey: key, filename: file.filename, mime: file.mime, size: file.buffer.length, uploadedById: u.id } });
    const after = await tx.document.update({ where: { id }, data: { currentVersion: version, lastAlertDays: null }, include });
    await audit(ctx, { entity: 'Document', entityId: id, action: 'upload_version', after: { version, filename: file.filename } }, tx);
    return after;
  });
}

export async function updateDocument(ctx: Ctx, u: PublicUser, id: string, meta: Partial<Meta>) {
  const before = await getDocument(u, id);
  assertCanEdit(u, before);
  if (meta.categoryId) await assertCategory(u, meta.categoryId);
  if (meta.links) await assertLinks(u, meta.links);
  const { links, ...rest } = meta;
  return prisma.$transaction(async (tx) => {
    if (links) {
      const added = links.filter((l) => !before.links.some((b) => b.entity === l.entity && b.entityId === l.entityId));
      await tx.documentLink.deleteMany({ where: { documentId: id } });
      await tx.documentLink.createMany({ data: links.map((l) => ({ ...l, documentId: id })) });
      await linkTimeline(tx, added, `Documento: ${rest.title ?? before.title}`, id, u.id);
    }
    // Nova validade → alertas recomeçam.
    const after = await tx.document.update({
      where: { id },
      data: { ...rest, ...(rest.tags && { tags: rest.tags.map((t) => t.toLowerCase()) }), ...(rest.expiresAt !== undefined && { lastAlertDays: null }) },
      include,
    });
    await audit(ctx, { entity: 'Document', entityId: id, action: 'update', before, after }, tx);
    return after;
  });
}

export async function fileUrl(ctx: Ctx, u: PublicUser, id: string, versionNo?: number, download = false) {
  const d = await getDocument(u, id);
  const v = await prisma.documentVersion.findUnique({ where: { documentId_version: { documentId: id, version: versionNo ?? d.currentVersion } } });
  if (!v) throw notFound('Versão');
  await audit(ctx, { entity: 'Document', entityId: id, action: download ? 'download' : 'view', after: { version: v.version } });
  return { url: signedUrl(v.storageKey, 300, download ? v.filename : undefined), mime: v.mime, filename: v.filename };
}
