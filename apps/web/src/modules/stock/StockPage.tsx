import { formatKz, STOCK_CATEGORY } from '@ivamarg/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatQty } from '../../lib/format';
import { useWarehouses } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';
import { MovementForm } from './MovementsPage';

export type Item = {
  id: string;
  code: string;
  name: string;
  category: keyof typeof STOCK_CATEGORY;
  unit: string;
  avgCost: string;
  minStock: string;
  active: boolean;
  onHand: number;
  reserved: number;
  available: number;
  belowMin: boolean;
  levels: { warehouseId: string; onHand: string; reserved: string; warehouse: { code: string; name: string } }[];
};

export function StockPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', category: '', warehouseId: '', belowMin: params.get('belowMin') ? '1' : '' });
  const items = useApi<Page<Item>>(`/stock/items${toQuery({ page, ...f, belowMin: f.belowMin ? 'true' : undefined })}`);
  const whs = useWarehouses();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title="Stock" actions={can('stock.create') && <div className="flex gap-2"><Link to="/stock/importar"><Button variant="secondary">Importar</Button></Link><Button onClick={() => setEditing('new')}>Novo artigo</Button></div>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Input placeholder="Código ou nome…" value={f.search} onChange={set('search')} />
        <Select value={f.category} onChange={set('category')}>
          <option value="">Todas as categorias</option>
          {Object.entries(STOCK_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.warehouseId} onChange={set('warehouseId')}>
          <option value="">Todos os armazéns</option>
          {whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!f.belowMin} onChange={(e) => { setF({ ...f, belowMin: e.target.checked ? '1' : '' }); setPage(1); }} />
          Só abaixo do mínimo
        </label>
      </div>
      <Alert>{items.error}</Alert>
      <Card>
        <Table head={['Código', 'Artigo', 'Físico', 'Reservado', 'Disponível', 'Mínimo', 'Custo médio', '']} empty={items.data?.items.length === 0}>
          {items.data?.items.map((i) => (
            <tr key={i.id} className={i.active ? '' : 'opacity-50'}>
              <Td className="font-mono text-xs">{i.code}</Td>
              <Td>
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-slate-500">{STOCK_CATEGORY[i.category]} · {i.levels.map((l) => `${l.warehouse.code}: ${formatQty(l.onHand)}`).join(' · ') || 'sem stock'}</div>
              </Td>
              <Td className="text-right whitespace-nowrap">{formatQty(i.onHand)} {i.unit}</Td>
              <Td className="text-right">{i.reserved ? formatQty(i.reserved) : '-'}</Td>
              <Td className="text-right font-medium whitespace-nowrap">{i.belowMin ? <Badge tone="red">{formatQty(i.available)}</Badge> : formatQty(i.available)}</Td>
              <Td className="text-right text-slate-500">{Number(i.minStock) ? formatQty(i.minStock) : '-'}</Td>
              <Td className="text-right whitespace-nowrap">{formatKz(Number(i.avgCost))}/{i.unit}</Td>
              <Td className="space-x-3 text-right whitespace-nowrap">
                {can('stock.edit') && <button className="text-brand-600 hover:underline" onClick={() => setMoving(i)}>Movimento</button>}
                {can('stock.edit') && <button className="text-brand-600 hover:underline" onClick={() => setEditing(i)}>Editar</button>}
                <Link className="text-slate-600 hover:underline" to={`/stock/movimentos?itemId=${i.id}`}>Histórico</Link>
              </Td>
            </tr>
          ))}
        </Table>
        {items.data && <Pagination {...items.data} onPage={setPage} />}
      </Card>
      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); items.reload(); }} />}
      {moving && <MovementForm item={moving} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); items.reload(); }} />}
    </>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: item?.code ?? '', name: item?.name ?? '', category: item?.category ?? 'RAW_MATERIAL', unit: item?.unit ?? 'm', minStock: Number(item?.minStock ?? 0), active: item?.active ?? true });
  const [error, setError] = useState('');
  // Artigo novo: propõe já o próximo código (pode ser alterado; vazio = gerado ao guardar).
  useEffect(() => {
    if (item) return;
    api<{ code: string }>('/stock/items/next-code').then((r) => setF((cur) => (cur.code ? cur : { ...cur, code: r.code }))).catch(() => {});
  }, [item]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(item ? `/stock/items/${item.id}` : '/stock/items', { method: item ? 'PATCH' : 'POST', body: f });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={item ? `Artigo ${item.code}` : 'Novo artigo'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
          <Field label="Código"><Input required={!!item} placeholder="automático" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Categoria">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Item['category'] })}>
              {Object.entries(STOCK_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Unidade"><Input required value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="m, kg, un…" /></Field>
          <Field label="Stock mínimo"><Input type="number" min={0} step="any" value={f.minStock} onChange={(e) => setF({ ...f, minStock: Number(e.target.value) })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo
        </label>
        <p className="text-xs text-slate-500">O custo médio é calculado automaticamente nas entradas (compras).</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
