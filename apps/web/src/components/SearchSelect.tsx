import { useEffect, useState } from 'react';
import { api, toQuery } from '../lib/api';
import type { Page } from '../lib/useApi';
import { Input } from './ui';

export type Opt = { id: string; label: string; hint?: string | null };

/** Selector com pesquisa no servidor. `path` deve aceitar ?search= e devolver Page<T>. */
export function SearchSelect<T>({ path, map, value, onChange, disabled, placeholder }: {
  path: string;
  map: (t: T) => Opt;
  value: Opt | null;
  onChange: (o: (Opt & { raw: T }) | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<{ o: Opt; raw: T }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(
      () => api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}${toQuery({ search: q, pageSize: 10 }).slice(1)}`).then((r) => setOpts(r.items.map((raw) => ({ o: map(raw), raw })))).catch(() => setOpts([])),
      250,
    );
    return () => clearTimeout(t);
  }, [q, open, path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (value)
    return (
      <div className="flex min-h-[38px] items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span>{value.label}{value.hint && <span className="ml-2 text-slate-400">{value.hint}</span>}</span>
        {!disabled && <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => onChange(null)} aria-label="Limpar">✕</button>}
      </div>
    );
  return (
    <div className="relative">
      <Input disabled={disabled} placeholder={placeholder ?? 'Pesquisar…'} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && opts.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {opts.map(({ o, raw }) => (
            <li key={o.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={() => { onChange({ ...o, raw }); setQ(''); }}>
                {o.label}{o.hint && <span className="ml-2 text-xs text-slate-400">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type StockItemRow = { id: string; code: string; name: string; unit: string; avgCost: string; available?: number };
export const itemOpt = (i: { id: string; code: string; name: string; unit: string }): Opt => ({ id: i.id, label: `${i.code} - ${i.name}`, hint: i.unit });
export const ItemSelect = (p: { value: Opt | null; onChange: (o: (Opt & { raw: StockItemRow }) | null) => void; disabled?: boolean }) => (
  <SearchSelect<StockItemRow> path="/stock/items" map={itemOpt} placeholder="Artigo (código ou nome)…" {...p} />
);
export type ModelRow = { id: string; reference: string; name: string; basePrice: number };
export const modelOpt = (m: { id: string; reference: string; name: string }): Opt => ({ id: m.id, label: `${m.reference} - ${m.name}` });
export const ModelSelect = (p: { value: Opt | null; onChange: (o: (Opt & { raw: ModelRow }) | null) => void; disabled?: boolean }) => (
  <SearchSelect<ModelRow> path="/catalog" map={modelOpt} placeholder="Modelo do catálogo…" {...p} />
);
export type SupplierRow = { id: string; name: string; nif: string | null };
export const SupplierSelect = (p: { value: Opt | null; onChange: (o: (Opt & { raw: SupplierRow }) | null) => void; disabled?: boolean }) => (
  <SearchSelect<SupplierRow> path="/stock/suppliers" map={(s) => ({ id: s.id, label: s.name, hint: s.nif })} placeholder="Fornecedor…" {...p} />
);
