import type { Prisma } from '@prisma/client';
import { TIMEZONE } from '@ivamarg/shared';

/** Próximo número "PREFIXO-AAAA-0001" (ano de Luanda). Atómico dentro da transacção. */
export async function nextNumber(tx: Prisma.TransactionClient, prefix: string) {
  const year = new Intl.DateTimeFormat('en', { timeZone: TIMEZONE, year: 'numeric' }).format(new Date());
  const key = `${prefix}-${year}`;
  const { value } = await tx.sequence.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return `${key}-${String(value).padStart(4, '0')}`;
}
