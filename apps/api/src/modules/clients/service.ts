import { clientSchema, normalizePhone, type ListQuery } from '@ivamarg/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, type Ctx } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { pageArgs, pageResult } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { assertOwner, ownerFilter, seesAll } from '../../lib/scope';
import { addTimeline } from '../../lib/timeline';
import type { PublicUser } from '../users/service';

type ClientData = z.output<typeof clientSchema>;
const include = { owner: { select: { id: true, name: true } }, businessLines: { select: { id: true, name: true } } };

export async function listClients(user: PublicUser, q: ListQuery & { ownerId?: string; businessLineId?: string; tag?: string }) {
  const s = q.search;
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    ...ownerFilter(user, 'clients'),
    ...(q.ownerId && seesAll(user, 'clients') && { ownerId: q.ownerId }),
    ...(q.businessLineId && { businessLines: { some: { id: q.businessLineId } } }),
    ...(q.tag && { tags: { has: q.tag } }),
    ...(s && {
      OR: [
        { name: { contains: s, mode: 'insensitive' } },
        { nif: { contains: s } },
        { email: { contains: s, mode: 'insensitive' } },
        ...(normalizePhone(s).length >= 6 ? [{ phones: { has: normalizePhone(s) } }] : []),
      ],
    }),
  };
  const [items, total] = await Promise.all([
    prisma.client.findMany({ where, include, ...pageArgs(q, ['name', 'createdAt'], { name: 'asc' }) }),
    prisma.client.count({ where }),
  ]);
  return pageResult(items, total, q);
}

export async function getClient(user: PublicUser, id: string) {
  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null },
    include: { ...include, contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });
  if (!client) throw notFound('Cliente');
  assertOwner(user, 'clients', client.ownerId);
  return client;
}

/** Clientes existentes com o mesmo NIF, telefone ou email. */
export async function findDuplicates(d: { nif?: string | null; phones?: string[]; email?: string | null }, excludeId?: string) {
  const phones = (d.phones ?? []).map(normalizePhone).filter(Boolean);
  const or: Prisma.ClientWhereInput[] = [
    ...(d.nif ? [{ nif: d.nif.trim() }] : []),
    ...(d.email ? [{ email: d.email.trim().toLowerCase() }] : []),
    ...(phones.length ? [{ phones: { hasSome: phones } }] : []),
  ];
  if (!or.length) return [];
  const found = await prisma.client.findMany({
    where: { deletedAt: null, OR: or, ...(excludeId && { id: { not: excludeId } }) },
    select: { id: true, name: true, nif: true, email: true, phones: true },
    take: 10,
  });
  return found.map((c) => ({
    ...c,
    matches: [
      d.nif && c.nif === d.nif.trim() && 'NIF',
      d.email && c.email === d.email.trim().toLowerCase() && 'email',
      c.phones.some((p) => phones.includes(p)) && 'telefone',
    ].filter(Boolean) as string[],
  }));
}

async function assertNoNifDuplicate(nif: string | null | undefined, excludeId?: string) {
  if (!nif) return;
  const dup = await prisma.client.findFirst({ where: { nif, deletedAt: null, ...(excludeId && { id: { not: excludeId } }) } });
  if (dup) throw new AppError(409, 'DUPLICATE_NIF', `Já existe um cliente com o NIF ${nif}: ${dup.name}`, { id: dup.id });
}

const toDb = (d: Partial<ClientData>) => {
  const { businessLineIds, ...rest } = d;
  return {
    ...rest,
    ...(rest.phones && { phones: [...new Set(rest.phones.map(normalizePhone))] }),
    ...(businessLineIds && { businessLines: { set: businessLineIds.map((id) => ({ id })) } }),
  };
};

export async function createClient(ctx: Ctx, user: PublicUser, data: ClientData, tx?: Prisma.TransactionClient) {
  await assertNoNifDuplicate(data.nif);
  // Sem "ver todos", o comercial fica responsável pelos clientes que cria.
  const ownerId = seesAll(user, 'clients') ? (data.ownerId ?? null) : user.id;
  const run = async (t: Prisma.TransactionClient) => {
    const { businessLineIds, ...rest } = data;
    const client = await t.client.create({
      data: {
        ...rest,
        phones: [...new Set(rest.phones.map(normalizePhone))],
        ownerId,
        createdById: user.id,
        businessLines: { connect: businessLineIds.map((id) => ({ id })) },
      },
      include,
    });
    await addTimeline(t, { clientId: client.id, title: 'Cliente criado', userId: user.id, entity: 'Client', entityId: client.id });
    await audit(ctx, { entity: 'Client', entityId: client.id, action: 'create', after: client }, t);
    return client;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function updateClient(ctx: Ctx, user: PublicUser, id: string, data: Partial<ClientData>) {
  const before = await getClient(user, id);
  if (data.nif !== undefined) await assertNoNifDuplicate(data.nif, id);
  if (!seesAll(user, 'clients')) delete data.ownerId; // não pode passar a carteira a outro
  return prisma.$transaction(async (tx) => {
    const after = await tx.client.update({ where: { id }, data: toDb(data), include });
    await audit(ctx, { entity: 'Client', entityId: id, action: 'update', before, after }, tx);
    return after;
  });
}

export async function deleteClient(ctx: Ctx, user: PublicUser, id: string) {
  const before = await getClient(user, id);
  await prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { entity: 'Client', entityId: id, action: 'delete', before });
}

// ─── Importação ─────────────────────────────────────────────

const HEADERS: Record<string, keyof ClientData> = {
  nome: 'name',
  name: 'name',
  nif: 'nif',
  telefone: 'phones',
  telefones: 'phones',
  telemovel: 'phones',
  email: 'email',
  morada: 'address',
  endereco: 'address',
  notas: 'notes',
  observacoes: 'notes',
  tags: 'tags',
  etiquetas: 'tags',
};
const norm = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export type ImportRow = { row: number; status: 'ok' | 'error' | 'duplicate'; name?: string; errors: string[] };

/** Valida linhas (cabeçalho → valor). Com dryRun=false cria só as linhas válidas e sem duplicados. */
export async function importClients(ctx: Ctx, user: PublicUser, rows: Record<string, unknown>[], dryRun: boolean) {
  const report: ImportRow[] = [];
  const valid: { row: number; data: ClientData }[] = [];
  const seen = { nif: new Set<string>(), email: new Set<string>(), phone: new Set<string>() };

  for (const [i, raw] of rows.entries()) {
    const row = i + 2; // linha 1 = cabeçalho
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const field = HEADERS[norm(k)];
      if (!field || v == null || String(v).trim() === '') continue;
      const s = String(v).trim();
      mapped[field] = field === 'phones' ? s.split(/[;/,]/).map((p) => p.trim()).filter(Boolean) : field === 'tags' ? s.split(',').map((t) => t.trim()).filter(Boolean) : s;
    }
    const parsed = clientSchema.safeParse(mapped);
    if (!parsed.success) {
      report.push({ row, status: 'error', name: String(mapped.name ?? ''), errors: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`) });
      continue;
    }
    const d = parsed.data;
    const phones = d.phones.map(normalizePhone);
    const inFile = [
      d.nif && seen.nif.has(d.nif) && 'NIF repetido no ficheiro',
      d.email && seen.email.has(d.email) && 'email repetido no ficheiro',
      phones.some((p) => seen.phone.has(p)) && 'telefone repetido no ficheiro',
    ].filter(Boolean) as string[];
    const existing = await findDuplicates(d);
    const errors = [...inFile, ...existing.map((c) => `já existe: ${c.name} (${c.matches.join(', ')})`)];
    if (d.nif) seen.nif.add(d.nif);
    if (d.email) seen.email.add(d.email);
    phones.forEach((p) => seen.phone.add(p));
    if (errors.length) report.push({ row, status: 'duplicate', name: d.name, errors });
    else {
      report.push({ row, status: 'ok', name: d.name, errors: [] });
      valid.push({ row, data: d });
    }
  }

  let created = 0;
  if (!dryRun) {
    await prisma.$transaction(async (tx) => {
      for (const v of valid) await createClient(ctx, user, v.data, tx);
    });
    created = valid.length;
    await audit(ctx, { entity: 'Client', action: 'import', after: { created, rows: rows.length } });
  }
  return {
    created,
    summary: {
      total: rows.length,
      ok: report.filter((r) => r.status === 'ok').length,
      duplicate: report.filter((r) => r.status === 'duplicate').length,
      error: report.filter((r) => r.status === 'error').length,
    },
    rows: report,
  };
}
