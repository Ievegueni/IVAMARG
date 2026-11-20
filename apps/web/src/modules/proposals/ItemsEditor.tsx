import { formatKz, lineTotal, proposalTotal } from '@ivamarg/shared';
import { Button, Input } from '../../components/ui';

export type Item = { description: string; quantity: number; unitPrice: number; discountPct: number };
export const emptyItem = (): Item => ({ description: '', quantity: 1, unitPrice: 0, discountPct: 0 });

/** Tabela de linhas (itens ou fases de obra) com totais calculados como no servidor. */
export function ItemsEditor({ items, onChange, readOnly, phases }: { items: Item[]; onChange: (i: Item[]) => void; readOnly?: boolean; phases?: boolean }) {
  const set = (i: number, k: keyof Item, v: string) =>
    onChange(items.map((it, j) => (j === i ? { ...it, [k]: k === 'description' ? v : Number(v) } : it)));
  const num = 'text-right tabular-nums';

  return (
    <>
    {/* Telemóvel: uma linha = um cartão */}
    <div className="space-y-3 sm:hidden">
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
          {readOnly ? <div className="font-medium">{it.description}</div> : <Input required placeholder={phases ? 'Fase' : 'Artigo / serviço'} value={it.description} onChange={(e) => set(i, 'description', e.target.value)} />}
          <div className={`grid gap-2 ${phases ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <label className="text-xs text-slate-500">Qtd{readOnly ? <div className="text-sm text-slate-900">{it.quantity}</div> : <Input type="number" min={0.001} step="any" required value={it.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} />}</label>
            <label className="text-xs text-slate-500">{phases ? 'Valor' : 'Preço'} (Kz){readOnly ? <div className="text-sm text-slate-900">{formatKz(it.unitPrice)}</div> : <Input type="number" min={0} step={1} required value={it.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} />}</label>
            {!phases && <label className="text-xs text-slate-500">Desc. %{readOnly ? <div className="text-sm text-slate-900">{it.discountPct}%</div> : <Input type="number" min={0} max={100} step="any" value={it.discountPct} onChange={(e) => set(i, 'discountPct', e.target.value)} />}</label>}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold tabular-nums">{formatKz(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</span>
            {!readOnly && <button type="button" disabled={items.length === 1} className="cursor-pointer text-xs text-red-600 disabled:opacity-30" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remover</button>}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        {!readOnly ? <Button type="button" variant="secondary" onClick={() => onChange([...items, emptyItem()])}>+ Linha</Button> : <span />}
        <span className="text-base font-semibold tabular-nums">Total {formatKz(proposalTotal(items))}</span>
      </div>
    </div>
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-2 text-left font-medium">{phases ? 'Fase' : 'Artigo / serviço'}</th>
            <th className="w-24 py-2 text-right font-medium">Qtd</th>
            <th className="w-36 py-2 text-right font-medium">{phases ? 'Valor' : 'Preço unit.'} (Kz)</th>
            {!phases && <th className="w-24 py-2 text-right font-medium">Desc. %</th>}
            <th className="w-36 py-2 text-right font-medium">Total</th>
            {!readOnly && <th className="w-8" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((it, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-2">{readOnly ? it.description : <Input required value={it.description} onChange={(e) => set(i, 'description', e.target.value)} />}</td>
              <td className={`py-1.5 pr-2 ${num}`}>{readOnly ? it.quantity : <Input type="number" min={0.001} step="any" required className={num} value={it.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} />}</td>
              <td className={`py-1.5 pr-2 ${num}`}>{readOnly ? formatKz(it.unitPrice) : <Input type="number" min={0} step={1} required className={num} value={it.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} />}</td>
              {!phases && <td className={`py-1.5 pr-2 ${num}`}>{readOnly ? `${it.discountPct}%` : <Input type="number" min={0} max={100} step="any" className={num} value={it.discountPct} onChange={(e) => set(i, 'discountPct', e.target.value)} />}</td>}
              <td className={`py-1.5 ${num}`}>{formatKz(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
              {!readOnly && (
                <td className="pl-2">
                  <button type="button" disabled={items.length === 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remover linha">✕</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={phases ? 2 : 3} className="pt-3">{!readOnly && <Button type="button" variant="secondary" onClick={() => onChange([...items, emptyItem()])}>+ Linha</Button>}</td>
            <td className="pt-3 text-right font-medium">Total</td>
            <td className={`pt-3 text-base font-semibold ${num}`}>{formatKz(proposalTotal(items))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}
