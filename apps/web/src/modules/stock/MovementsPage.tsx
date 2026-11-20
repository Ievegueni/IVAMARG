import { formatDateTime, formatKz, MOVEMENT_TYPE } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatQty } from '../../lib/format';
import { useWarehouses } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';

type Mov = {
  id: string;
  type: keyof typeof MOVEMENT_TYPE;
  quantity: string;
  unitCost: string | null;
  sourceType: string;
  sourceId: string | null;
  notes: string | null;
  createdAt: string;
  item: { code: string; name: string; unit: string };
  warehouse: { code: string };
  toWarehouse: { code: string } | null;
};
const SOURCES: Record<string, string> = { PURCHASE: 'Compra', PRODUCTION_ORDER: 'Ordem de produção', PROJECT: 'Obra', INVENTORY: 'Inventário', MANUAL: 'Manual' };

export function MovementsPage() {
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ type: '', warehouseId: '', sourceType: '' });
  const whs = useWarehouses();
  const list = useApi<Page<Mov>>(`/stock/movements${toQuery({ page, ...f, itemId: params.get('itemId') ?? undefined })}`);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title="Movimentos de stock" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={f.type} onChange={set('type')}>
          <option value="">Todos os tipos</option>
          {Object.entries(MOVEMENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.warehouseId} onChange={set('warehouseId')}>
          <option value="">Todos os armazéns</option>
          {whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select value={f.sourceType} onChange={set('sourceType')}>
          <option value="">Todas as origens</option>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Data', 'Tipo', 'Artigo', 'Quantidade', 'Armazém', 'Custo unit.', 'Origem']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((m) => (
            <tr key={m.id}>
              <Td className="whitespace-nowrap text-slate-500">{formatDateTime(m.createdAt)}</Td>
              <Td><Badge tone={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'red' : m.type === 'RESERVE' ? 'amber' : 'slate'}>{MOVEMENT_TYPE[m.type]}</Badge></Td>
              <Td><span className="font-mono text-xs">{m.item.code}</span> {m.item.name}</Td>
              <Td className="text-right whitespace-nowrap">{formatQty(m.quantity)} {m.item.unit}</Td>
              <Td className="whitespace-nowrap">{m.warehouse.code}{m.toWarehouse && ` → ${m.toWarehouse.code}`}</Td>
              <Td className="text-right">{m.unitCost ? formatKz(Number(m.unitCost)) : '-'}</Td>
              <Td className="text-slate-600">{SOURCES[m.sourceType] ?? m.sourceType}{m.notes && <div className="text-xs text-slate-400">{m.notes}</div>}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </>
  );
}

/** Movimento manual: entrada avulsa, saída, transferência ou ajuste (com motivo). */
export function MovementForm({ item, onClose, onSaved }: { item: { id: string; code: string; name: string; unit: string }; onClose: () => void; onSaved: () => void }) {
  const whs = useWarehouses();
  const [f, setF] = useState({ type: 'IN', warehouseId: '', toWarehouseId: '', quantity: '', unitCost: '', notes: '' });
  const [error, setError] = useState('');
  const wh = f.warehouseId || whs.data?.[0]?.id || '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const base = { type: f.type, itemId: item.id, warehouseId: wh, notes: f.notes || null };
    const body =
      f.type === 'IN' ? { ...base, quantity: f.quantity, unitCost: f.unitCost }
      : f.type === 'OUT' ? { ...base, quantity: f.quantity }
      : f.type === 'TRANSFER' ? { ...base, quantity: f.quantity, toWarehouseId: f.toWarehouseId }
      : { ...base, delta: f.quantity };
    try {
      await api('/stock/movements', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={`Movimento - ${item.code} ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="IN">Entrada avulsa</option>
              <option value="OUT">Saída</option>
              <option value="TRANSFER">Transferência</option>
              <option value="ADJUSTMENT">Ajuste (+/−)</option>
            </Select>
          </Field>
          <Field label="Armazém">
            <Select value={wh} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
              {whs.data?.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label={f.type === 'ADJUSTMENT' ? `Diferença (${item.unit}, negativo para retirar)` : `Quantidade (${item.unit})`}>
            <Input type="number" step="any" required value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          </Field>
          {f.type === 'IN' && <Field label="Custo unitário (Kz)"><Input type="number" min={0} step="any" required value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>}
          {f.type === 'TRANSFER' && (
            <Field label="Para o armazém">
              <Select required value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}>
                <option value="">-</option>
                {whs.data?.filter((w) => w.active && w.id !== wh).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label={f.type === 'ADJUSTMENT' ? 'Motivo (obrigatório)' : 'Notas'}><Textarea required={f.type === 'ADJUSTMENT'} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {f.type === 'IN' && <p className="text-xs text-slate-500">Para compras a fornecedores use o módulo Compras (fica o registo da compra).</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Registar</Button>
        </div>
      </form>
    </Modal>
  );
}
