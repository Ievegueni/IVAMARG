import { describe, expect, it } from 'vitest';
import { visitDates } from './visits';

describe('planeamento de visitas', () => {
  it('dias da semana à hora de Luanda, só no futuro', () => {
    // 2026-11-10 é terça. Seg(1) e qui(4) às 08:00 Luanda = 07:00 UTC.
    const from = new Date('2026-11-10T10:00:00Z');
    const d = visitDates([1, 4], '08:00', 2, from).map((x) => x.toISOString());
    expect(d).toEqual(['2026-11-12T07:00:00.000Z', '2026-11-16T07:00:00.000Z', '2026-11-19T07:00:00.000Z', '2026-11-23T07:00:00.000Z']); // 14 dias: 10 a 23
  });
  it('domingo = 7', () => {
    expect(visitDates([7], '09:30', 1, new Date('2026-11-10T00:00:00Z')).map((x) => x.toISOString())).toEqual(['2026-11-15T08:30:00.000Z']);
  });
});
