import { logged } from '../jobs/integration-log';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

// Vendus API v1.1 - autenticação HTTP Basic com a API key como utilizador.
// ⚠️ Por validar com a conta do cliente (CLAUDE.md §5.10): formato dos itens, domínio para Angola e PDF.
export class VendusNotConfigured extends Error {
  constructor() {
    super('VENDUS_API_KEY não configurada');
  }
}

export async function vendus<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  if (!env.VENDUS_API_KEY) throw new VendusNotConfigured();
  return logged('vendus', `${method} ${path}`, body, async () => {
    const res = await fetch(`${env.VENDUS_API_URL}/${path.replace(/^\//, '')}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${env.VENDUS_API_KEY}:`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vendus ${res.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : null) as T;
  });
}

/** PDF de um documento (binário, não passa pelo IntegrationLog). */
export async function vendusPdf(documentId: string) {
  if (!env.VENDUS_API_KEY) throw new AppError(503, 'VENDUS_NOT_CONFIGURED', 'Integração Vendus não configurada');
  const res = await fetch(`${env.VENDUS_API_URL}/documents/${documentId}.pdf`, {
    headers: { Authorization: `Basic ${Buffer.from(`${env.VENDUS_API_KEY}:`).toString('base64')}` },
  });
  if (!res.ok) throw new AppError(502, 'VENDUS_ERROR', `Vendus respondeu ${res.status} ao pedir o PDF`);
  return Buffer.from(await res.arrayBuffer());
}

async function ref(entity: string, entityId: string) {
  return (await prisma.externalRef.findUnique({ where: { entity_entityId_system: { entity, entityId, system: 'vendus' } } }))?.externalId;
}
const saveRef = (entity: string, entityId: string, externalId: string) =>
  prisma.externalRef.upsert({
    where: { entity_entityId_system: { entity, entityId, system: 'vendus' } },
    create: { entity, entityId, system: 'vendus', externalId },
    update: { externalId },
  });

/** Garante o cliente no Vendus (push) e devolve o id externo. */
export async function ensureClient(clientId: string) {
  const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const body = { name: c.name, fiscal_id: c.nif ?? undefined, email: c.email ?? undefined, address: c.address ?? undefined, phone: c.phones[0] ?? undefined };
  const existing = await ref('Client', clientId);
  if (existing) {
    await vendus('PATCH', `clients/${existing}`, body);
    return existing;
  }
  const created = await vendus<{ id: number | string }>('POST', 'clients', body);
  await saveRef('Client', clientId, String(created.id));
  return String(created.id);
}

/** Garante o modelo do catálogo como produto no Vendus (pela referência). */
export async function ensureProduct(modelId: string) {
  const existing = await ref('ProductModel', modelId);
  if (existing) return existing;
  const m = await prisma.productModel.findUniqueOrThrow({ where: { id: modelId } });
  const created = await vendus<{ id: number | string }>('POST', 'products', { reference: m.reference, title: m.name, gross_price: m.basePrice });
  await saveRef('ProductModel', modelId, String(created.id));
  return String(created.id);
}
