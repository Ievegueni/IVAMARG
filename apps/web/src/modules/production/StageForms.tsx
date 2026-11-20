import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Select } from '../../components/ui';
import { errMsg } from '../../lib/format';

export type StageInfo = { id: string; name: string; type: 'INTERNAL' | 'EXTERNAL' | 'QUALITY'; order: number };
export type OpenLog = { id: string; stageId: string; qtyIn: number };
export type FinishBody = { qtyDone: number; qtyRejected: number; qtyRework: number; reworkStageId: string | null; cost: number; defects: { defectTypeId: string; quantity: number }[] };

const big = 'text-lg py-3 text-center';

/** Conclusão de etapa: normal (concluídas/rejeitadas), externa (+ custo) ou qualidade (aprovadas/retrabalho/refugo + defeitos). */
export function FinishForm({ log, stage, stages, defectTypes, onSubmit, large }: {
  log: OpenLog; stage: StageInfo; stages: StageInfo[]; defectTypes: { id: string; name: string }[];
  onSubmit: (b: FinishBody) => Promise<unknown>; large?: boolean;
}) {
  const isQ = stage.type === 'QUALITY';
  const [done, setDone] = useState(log.qtyIn);
  const [rej, setRej] = useState(0);
  const [rework, setRework] = useState(0);
  const [reworkStage, setReworkStage] = useState('');
  const [cost, setCost] = useState(0);
  const [defects, setDefects] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sum = done + rej + (isQ ? rework : 0);
  const cls = large ? big : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sum !== log.qtyIn) return setError(`As quantidades têm de somar ${log.qtyIn}`);
    setBusy(true);
    try {
      await onSubmit({
        qtyDone: done, qtyRejected: rej, qtyRework: isQ ? rework : 0, reworkStageId: isQ && rework ? reworkStage : null, cost,
        defects: Object.entries(defects).filter(([, q]) => q > 0).map(([defectTypeId, quantity]) => ({ defectTypeId, quantity })),
      });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  // Ajusta as concluídas automaticamente quando se mexe nas outras.
  const setOther = (r: number, w: number) => { setRej(r); setRework(w); setDone(Math.max(0, log.qtyIn - r - (isQ ? w : 0))); };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Alert>{error}</Alert>
      <div className="text-sm text-slate-600">{stage.name}: {log.qtyIn} peça(s) em curso.</div>
      <div className={`grid gap-3 ${isQ ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Field label={isQ ? 'Aprovadas' : stage.type === 'EXTERNAL' ? 'Recebidas OK' : 'Concluídas'}><Input type="number" min={0} className={cls} value={done} onChange={(e) => setDone(Number(e.target.value))} /></Field>
        {isQ && <Field label="Retrabalho"><Input type="number" min={0} className={cls} value={rework} onChange={(e) => setOther(rej, Number(e.target.value))} /></Field>}
        <Field label={isQ ? 'Refugo' : 'Rejeitadas'}><Input type="number" min={0} className={cls} value={rej} onChange={(e) => setOther(Number(e.target.value), rework)} /></Field>
      </div>
      {isQ && rework > 0 && (
        <Field label="Retrabalho volta à etapa">
          <Select required value={reworkStage} onChange={(e) => setReworkStage(e.target.value)} className={cls}>
            <option value="">- Escolher -</option>
            {stages.filter((s) => s.order < stage.order && s.type !== 'QUALITY').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      {stage.type === 'EXTERNAL' && <Field label="Custo do serviço externo (Kz)"><Input type="number" min={0} step={1} className={cls} value={cost} onChange={(e) => setCost(Number(e.target.value))} /></Field>}
      {(rej > 0 || (isQ && rework > 0)) && defectTypes.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Defeitos (opcional)</div>
          <div className="grid grid-cols-2 gap-2">
            {defectTypes.map((d) => (
              <label key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1 text-sm">
                <span>{d.name}</span>
                <Input type="number" min={0} className="w-16 px-1 text-center" value={defects[d.id] ?? ''} onChange={(e) => setDefects({ ...defects, [d.id]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className={`text-sm ${sum === log.qtyIn ? 'text-slate-500' : 'text-red-600'}`}>Total: {sum} / {log.qtyIn}</div>
      <Button type="submit" disabled={busy} className={large ? 'w-full py-4 text-lg' : 'w-full'}>Concluir</Button>
    </form>
  );
}
