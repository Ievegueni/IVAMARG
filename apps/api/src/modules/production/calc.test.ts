import { describe, expect, it } from 'vitest';
import { computeRequirements, costSummary, deviationPct, labourCost, lotFlow, margin, pieceRate, splitLots, type LogLite } from './calc';

describe('necessidades de material', () => {
  const bom = [
    { productModelId: 'polo', stockItemId: 'tecido', size: null, consumption: 1.2 },
    { productModelId: 'polo', stockItemId: 'tecido', size: 'XL', consumption: 1.5 },
    { productModelId: 'polo', stockItemId: 'botao', size: null, consumption: 3 },
    { productModelId: 'calca', stockItemId: 'tecido', size: null, consumption: '1.333' },
  ];
  it('usa consumo do tamanho quando existe, senão o genérico, e soma entre modelos', () => {
    const r = computeRequirements(
      [
        { productModelId: 'polo', sizeGrid: { M: 10, XL: 4 } },
        { productModelId: 'calca', sizeGrid: { M: 3 } },
      ],
      bom,
    );
    expect(r.get('tecido')).toBe(10 * 1.2 + 4 * 1.5 + 3 * 1.333); // 21.999
    expect(r.get('botao')).toBe(42);
  });
  it('ignora tamanhos a zero e modelos sem BOM', () => {
    const r = computeRequirements([{ productModelId: 'polo', sizeGrid: { S: 0 } }, { productModelId: 'x', sizeGrid: { M: 5 } }], bom);
    expect(r.size).toBe(0);
  });
});

describe('lotes', () => {
  it('divide cada tamanho em lotes até ao máximo', () => {
    expect(splitLots({ S: 120, M: 50, L: 0 }, 50)).toEqual([
      { size: 'S', quantity: 50 },
      { size: 'S', quantity: 50 },
      { size: 'S', quantity: 20 },
      { size: 'M', quantity: 50 },
    ]);
  });
});

describe('fluxo entre etapas', () => {
  const stages = [{ id: 'corte', order: 1 }, { id: 'costura', order: 2 }, { id: 'qc', order: 3 }, { id: 'emb', order: 4 }];
  const log = (stageId: string, qtyIn: number, done = 0, rej = 0, fin = true, rework = 0, reworkStageId: string | null = null): LogLite => ({
    stageId, qtyIn, qtyDone: done, qtyRejected: rej, qtyRework: rework, reworkStageId, finishedAt: fin ? new Date() : null,
  });

  it('fluxo parcial: só pode iniciar o que a etapa anterior concluiu', () => {
    const { flow } = lotFlow(50, stages, [log('corte', 50, 30, 0, true), log('costura', 20, 0, 0, false)]);
    expect(flow.get('corte')!.available).toBe(0);
    expect(flow.get('costura')!.available).toBe(10); // 30 cortadas − 20 iniciadas
    expect(flow.get('costura')!.inProgress).toBe(20);
    expect(flow.get('qc')!.available).toBe(0);
  });

  it('retrabalho volta à etapa definida; refugo sai; lote completo', () => {
    const logs = [
      log('corte', 10, 10),
      log('costura', 10, 10),
      log('qc', 10, 7, 1, true, 2, 'costura'), // 7 aprovadas, 1 refugo, 2 retrabalho → costura
      log('costura', 2, 2),
      log('qc', 2, 2),
      log('emb', 9, 9),
    ];
    const r = lotFlow(10, stages, logs);
    expect(r.flow.get('costura')!.inflow).toBe(12);
    expect(r.flow.get('emb')!.inflow).toBe(9);
    expect(r.finished).toBe(9);
    expect(r.scrapped).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('não está completo com registos em curso', () => {
    expect(lotFlow(5, stages, [log('corte', 5, 0, 0, false)]).complete).toBe(false);
  });
});

describe('custos e pagamento à peça', () => {
  const rates = [
    { stageId: 'costura', productModelId: null, rate: 150 },
    { stageId: 'costura', productModelId: 'polo', rate: 200 },
  ];
  it('valor por peça: modelo > genérico > 0', () => {
    expect(pieceRate(rates, 'costura', 'polo')).toBe(200);
    expect(pieceRate(rates, 'costura', 'calca')).toBe(150);
    expect(pieceRate(rates, 'corte', 'polo')).toBe(0);
  });
  it('só paga à peça operadores PIECE/MIXED', () => {
    expect(labourCost('PIECE', 30, 200)).toBe(6000);
    expect(labourCost('MIXED', 30, 200)).toBe(6000);
    expect(labourCost('FIXED', 30, 200)).toBe(0);
  });
  it('custo por peça e margem', () => {
    const c = costSummary({ material: 300_000, labour: 90_000, external: 60_000, pieces: 100 });
    expect(c.total).toBe(450_000);
    expect(c.perPiece).toBe(4500);
    expect(margin(600_000, c.total, 20)).toEqual({ value: 150_000, pct: 25, belowMin: false });
    expect(margin(500_000, c.total, 20).belowMin).toBe(true);
    expect(costSummary({ material: 1, labour: 0, external: 0, pieces: 0 }).perPiece).toBe(0);
  });
  it('desvio de consumo', () => {
    expect(deviationPct(100, 112)).toBe(12);
    expect(deviationPct(100, 95)).toBe(-5);
    expect(deviationPct(0, 0)).toBe(0);
  });
});
