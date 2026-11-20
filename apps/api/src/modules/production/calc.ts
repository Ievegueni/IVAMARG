// Regras de produção puras (sem BD) - testadas em calc.test.ts.

type Num = number | { toString(): string };
const n = (v: Num) => Number(v.toString());

export type BomRow = { productModelId: string; stockItemId: string; size: string | null; consumption: Num };
export type ItemPlan = { productModelId: string; sizeGrid: Record<string, number> };

/**
 * Necessidades = Σ (qtd por tamanho × consumo por tamanho), por material.
 * Consumo do tamanho específico se existir; senão a linha genérica (size null) do mesmo material.
 * Resultado em milésimas arredondadas (Decimal 12,3).
 */
export function computeRequirements(items: ItemPlan[], bom: BomRow[]) {
  const req = new Map<string, number>();
  for (const it of items) {
    const lines = bom.filter((b) => b.productModelId === it.productModelId);
    const materials = new Set(lines.map((l) => l.stockItemId));
    for (const [size, qty] of Object.entries(it.sizeGrid)) {
      if (!qty) continue;
      for (const m of materials) {
        const line = lines.find((l) => l.stockItemId === m && l.size === size) ?? lines.find((l) => l.stockItemId === m && l.size === null);
        if (line) req.set(m, (req.get(m) ?? 0) + qty * n(line.consumption));
      }
    }
  }
  for (const [k, v] of req) req.set(k, Math.round(v * 1000) / 1000);
  return req;
}

/** Divide cada tamanho em lotes de até `lotSize` peças. */
export function splitLots(sizeGrid: Record<string, number>, lotSize: number) {
  const lots: { size: string; quantity: number }[] = [];
  const max = Math.max(1, Math.floor(lotSize));
  for (const [size, qty] of Object.entries(sizeGrid)) {
    for (let left = qty; left > 0; left -= max) lots.push({ size, quantity: Math.min(max, left) });
  }
  return lots;
}

export type StageLite = { id: string; order: number };
export type LogLite = { stageId: string; qtyIn: number; qtyDone: number; qtyRejected: number; qtyRework: number; reworkStageId: string | null; finishedAt: Date | null };
export type StageFlow = { inflow: number; started: number; inProgress: number; done: number; rejected: number; available: number };

/**
 * Fluxo de um lote pelas etapas (permite fluxo parcial):
 *  entrada(1ª) = qtd do lote; entrada(k) = concluídas(k−1) + retrabalho enviado para k
 *  disponível(k) = entrada(k) − iniciadas(k)
 */
export function lotFlow(lotQty: number, stages: StageLite[], logs: LogLite[]) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const flow = new Map<string, StageFlow>();
  const rework = new Map<string, number>();
  for (const l of logs) if (l.qtyRework && l.reworkStageId) rework.set(l.reworkStageId, (rework.get(l.reworkStageId) ?? 0) + l.qtyRework);
  let prevDone = lotQty;
  for (const s of ordered) {
    const mine = logs.filter((l) => l.stageId === s.id);
    const started = mine.reduce((t, l) => t + l.qtyIn, 0);
    const done = mine.reduce((t, l) => t + l.qtyDone, 0);
    const rejected = mine.reduce((t, l) => t + l.qtyRejected, 0);
    const inProgress = mine.filter((l) => !l.finishedAt).reduce((t, l) => t + l.qtyIn, 0);
    const inflow = prevDone + (rework.get(s.id) ?? 0);
    flow.set(s.id, { inflow, started, inProgress, done, rejected, available: inflow - started });
    prevDone = done;
  }
  const last = ordered.at(-1);
  const finished = last ? flow.get(last.id)!.done : 0;
  const scrapped = [...flow.values()].reduce((t, f) => t + f.rejected, 0);
  const inProgress = [...flow.values()].reduce((t, f) => t + f.inProgress, 0);
  return { flow, finished, scrapped, complete: inProgress === 0 && finished + scrapped >= lotQty };
}

/** Valor por peça de uma etapa: específico do modelo, senão o genérico da etapa, senão 0. */
export function pieceRate(rates: { stageId: string; productModelId: string | null; rate: number }[], stageId: string, modelId: string) {
  return rates.find((r) => r.stageId === stageId && r.productModelId === modelId)?.rate ?? rates.find((r) => r.stageId === stageId && r.productModelId === null)?.rate ?? 0;
}

/** Custo de mão-de-obra de um registo: só operadores pagos à peça (PIECE/MIXED). */
export const labourCost = (payModel: 'FIXED' | 'PIECE' | 'MIXED' | null | undefined, qtyDone: number, rate: number) =>
  payModel === 'PIECE' || payModel === 'MIXED' ? qtyDone * rate : 0;

/** Custo por peça = (material real + mão-de-obra + externo) / peças concluídas. */
export function costSummary(c: { material: number; labour: number; external: number; pieces: number }) {
  const total = c.material + c.labour + c.external;
  return { ...c, total, perPiece: c.pieces ? Math.round(total / c.pieces) : 0 };
}

/** Margem da encomenda (Kz e %) e se está abaixo do mínimo configurado. */
export function margin(salePrice: number, cost: number, minPct: number) {
  const value = salePrice - cost;
  const pct = salePrice ? Math.round((value / salePrice) * 1000) / 10 : 0;
  return { value, pct, belowMin: pct < minPct };
}

/** Desvio do consumo real face ao teórico, em %. */
export const deviationPct = (theoretical: number, real: number) => (theoretical ? Math.round(((real - theoretical) / theoretical) * 1000) / 10 : real ? 100 : 0);
