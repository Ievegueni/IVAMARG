import type { Prisma } from '@prisma/client';

/** Acrescenta um evento à timeline do cliente. Usado por todos os módulos. */
export const addTimeline = (
  tx: Prisma.TransactionClient,
  e: { clientId: string; title: string; type?: string; body?: string | null; entity?: string; entityId?: string; userId?: string; occurredAt?: Date },
) => tx.timelineEvent.create({ data: { type: 'SYSTEM', ...e } });
