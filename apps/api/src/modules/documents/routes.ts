import multipart from '@fastify/multipart';
import { DOCUMENT_MIME, documentCategorySchema, documentFolderSchema, documentMetaSchema, listQuerySchema, MAX_UPLOAD_MB } from '@ivamarg/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { readSigned } from '../../lib/storage';
import * as docs from './service';

type Id = { Params: { id: string } };

/** Lê o ficheiro e os campos de um pedido multipart (campo "meta" com JSON). */
async function readUpload(req: FastifyRequest) {
  let file: docs.Upload | undefined;
  let meta: unknown;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (!(DOCUMENT_MIME as readonly string[]).includes(part.mimetype)) throw new AppError(415, 'INVALID_FILE_TYPE', 'Tipo de ficheiro não permitido (PDF, imagem, Word, Excel, CSV)');
      const buffer = await part.toBuffer();
      if (part.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', `Ficheiro acima de ${MAX_UPLOAD_MB} MB`);
      file = { buffer, filename: part.filename, mime: part.mimetype };
    } else if (part.fieldname === 'meta') meta = JSON.parse(String(part.value));
  }
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Ficheiro obrigatório');
  return { file, meta };
}

const MIME_BY_EXT: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.csv': 'text/csv' };

export async function documentRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 }, throwFileSizeLimit: false });
  const view = { preHandler: app.guard('documents.view') };
  const create = { preHandler: app.guard('documents.create') };
  const cfg = { preHandler: app.guard('backoffice.edit') };

  app.get('/', view, (req) =>
    docs.listDocuments(
      req.currentUser!,
      listQuerySchema.extend({ categoryId: z.string().optional(), folderId: z.string().optional(), entity: z.string().optional(), entityId: z.string().optional(), expiring: z.coerce.number().optional(), tag: z.string().optional() }).parse(req.query),
    ),
  );
  app.post('/', { ...create, bodyLimit: (MAX_UPLOAD_MB + 1) * 1024 * 1024 }, async (req) => {
    const { file, meta } = await readUpload(req);
    return docs.createDocument(ctxOf(req), req.currentUser!, documentMetaSchema.parse(meta), file);
  });

  // ── Categorias e pastas (antes de /:id) ──
  app.get('/categories', view, async (req) => prisma.documentCategory.findMany({ where: docs.categoryFilter(req.currentUser!), orderBy: { name: 'asc' } }));
  app.post('/categories', cfg, async (req) => {
    const c = await prisma.documentCategory.create({ data: documentCategorySchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'DocumentCategory', entityId: c.id, action: 'create', after: c });
    return c;
  });
  app.patch<Id>('/categories/:id', cfg, async (req) => {
    const before = await prisma.documentCategory.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Categoria');
    const after = await prisma.documentCategory.update({ where: { id: before.id }, data: documentCategorySchema.partial().parse(req.body) });
    await audit(ctxOf(req), { entity: 'DocumentCategory', entityId: before.id, action: 'update', before, after });
    return after;
  });
  app.get('/folders', view, () => prisma.documentFolder.findMany({ orderBy: { name: 'asc' } }));
  app.post('/folders', create, async (req) => {
    const f = await prisma.documentFolder.create({ data: documentFolderSchema.parse(req.body) });
    await audit(ctxOf(req), { entity: 'DocumentFolder', entityId: f.id, action: 'create', after: f });
    return f;
  });

  app.get<Id>('/:id', view, (req) => docs.getDocument(req.currentUser!, req.params.id));
  app.patch<Id>('/:id', view, (req) => docs.updateDocument(ctxOf(req), req.currentUser!, req.params.id, documentMetaSchema.partial().parse(req.body)));
  app.post<Id>('/:id/versions', { ...view, bodyLimit: (MAX_UPLOAD_MB + 1) * 1024 * 1024 }, async (req) => {
    const { file } = await readUpload(req);
    return docs.addVersion(ctxOf(req), req.currentUser!, req.params.id, file);
  });
  app.get<Id & { Querystring: { version?: string; download?: string } }>('/:id/url', view, (req) =>
    docs.fileUrl(ctxOf(req), req.currentUser!, req.params.id, req.query.version ? Number(req.query.version) : undefined, req.query.download === '1'),
  );
  app.delete<Id>('/:id', { preHandler: app.guard('documents.delete') }, async (req) => {
    const d = await docs.getDocument(req.currentUser!, req.params.id);
    await prisma.document.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    await audit(ctxOf(req), { entity: 'Document', entityId: d.id, action: 'delete', before: { title: d.title } });
    return { ok: true };
  });
}

/** Ficheiros locais servidos por URL assinado (sem sessão: a assinatura temporária é a autorização). */
export async function fileRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { key: string; exp: string; sig: string; name?: string } }>('/', async (req, reply) => {
    const { key, exp, sig, name } = req.query;
    const buf = key && sig ? await readSigned(key, Number(exp), sig) : null;
    if (!buf) throw new AppError(403, 'INVALID_LINK', 'Link inválido ou expirado');
    const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
    reply.header('Cache-Control', 'private, max-age=60').header('X-Content-Type-Options', 'nosniff').type(MIME_BY_EXT[ext] ?? 'application/octet-stream');
    if (name) reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(buf);
  });
}
