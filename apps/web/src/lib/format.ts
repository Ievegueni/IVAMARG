/** Data (ISO) → valor para <input type="date">. Datas sem hora são guardadas a 00:00 UTC. */
export const toDateInput = (d?: string | null) => (d ? d.slice(0, 10) : '');

/** 244923456789 → +244 923 456 789 */
export const formatPhone = (p: string) => (p.length === 12 && p.startsWith('244') ? `+244 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

export const errMsg = (e: unknown) => (e as Error).message;

/** Quantidades de material (até 3 casas): 1234.5 → "1.234,5" */
export const formatQty = (v: number | string) => Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 3 });

/** AAAA-MM-DD do dia local (sem passar por UTC, que recua um dia a leste de Greenwich). */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const monthStartDate = (d = new Date()) => localDate(new Date(d.getFullYear(), d.getMonth(), 1));
