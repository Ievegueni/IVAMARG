import type { ListQuery } from '@ivamarg/shared';

/** `sort` = "campo" ou "-campo"; só campos da lista `allowed`. */
export function pageArgs(q: ListQuery, allowed: string[], fallback: Record<string, 'asc' | 'desc'>) {
  const field = q.sort?.replace(/^-/, '');
  const orderBy = field && allowed.includes(field) ? { [field]: q.sort!.startsWith('-') ? 'desc' : 'asc' } : fallback;
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy };
}

export const pageResult = <T>(items: T[], total: number, q: ListQuery) => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
});
