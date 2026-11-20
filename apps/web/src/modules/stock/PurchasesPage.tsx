import { formatDate, formatKz } from '@ivamarg/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { itemOpt, SupplierSelect, ItemSelect, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatQty, toDateInput } from '../../lib/format';
import { useWarehouses } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';

const STATUS = { DRAFT: 'Rascunho', RECEIVED: 'Recebida', CANCELLED: 'Cancelada' } as const;
type Purchase = {
  id: string;
  number: string;
  status: keyof typeof STATUS;
  warehouseId: string;
  expectedAt: string | null;
  receivedAt: string | null;
  total: number;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string; nif?: string | null };
  lines: { itemId: string; quantity: string; unitCost: number; total: number; item: { id: string; code: string; name: string; unit: string } }[];
};

export function PurchasesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: '' });
  const list = useApi<Page<Purchase>>(`/stock/purchases${toQuery({ page, ...f })}`);
  return (
    <>
      <PageHeader title="Compras" actions={can('stock.create') && <Link to="/stock/compras/nova"><Button>Nova compra</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Número ou fornecedor…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}>
          <option value="">Todos os estados</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', 'Fornecedor', 'Estado', 'Prevista', 'Recebida', 'Total']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/stock/compras/${p.id}`)}>
              <Td className="font-medium">{p.number}</Td>
              <Td>{p.supplier.name}</Td>
              <Td><Badge tone={p.status === 'RECEIVED' ? 'green' : p.status === 'CANCELLED' ? 'red' : 'slate'}>{STATUS[p.status]}</Badge></Td>
              <Td>{p.expectedAt ? formatDate(p.expectedAt) : '-'}</Td>
              <Td>{p.receivedAt ? formatDate(p.receivedAt) : '-'}</Td>
              <Td className="text-right">{formatKz(p.total)}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </>
  );
}

type Line = { item: Opt | null; quantity: string; unitCost: string };

export function PurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const res = useApi<Purchase>(id ? `/stock/purchases/${id}` : null);
  const whs = useWarehouses();
  const [supplier, setSupplier] = useState<Opt | null>(null);
  const [f, setF] = useState({ warehouseId: '', expectedAt: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([{ item: null, quantity: '', unitCost: '' }]);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const [modal, setModal] = useState<'receive' | 'cancel' | null>(null);
  const p = res.data;

  useEffect(() => {
    if (!p) return;
    setSupplier({ id: p.supplier.id, label: p.supplier.name });
    setF({ warehouseId: p.warehouseId, expectedAt: toDateInput(p.expectedAt), notes: p.notes ?? '' });
    setLines(p.lines.map((l) => ({ item: itemOpt(l.item), quantity: String(Number(l.quantity)), unitCost: String(l.unitCost) })));
  }, [p]);

  if (res.error) return <Alert>{res.error}</Alert>;
  if (id && !p) return <div className="text-slate-500">A carregar…</div>;
  const editable = (!p || p.status === 'DRAFT') && can(p ? 'stock.edit' : 'stock.create');
  const total = lines.reduce((s, l) => s + Math.round(Number(l.quantity || 0) * Number(l.unitCost || 0)), 0);
  const wh = f.warehouseId || whs.data?.[0]?.id || '';
  const setLine = (i: number, d: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...d } : l)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supplier) return setMsg({ tone: 'error', text: 'Seleccione o fornecedor' });
    if (lines.some((l) => !l.item)) return setMsg({ tone: 'error', text: 'Seleccione o artigo em todas as linhas' });
    const body = { supplierId: supplier.id, warehouseId: wh, expectedAt: f.expectedAt || null, notes: f.notes || null, lines: lines.map((l) => ({ itemId: l.item!.id, quantity: l.quantity, unitCost: l.unitCost })) };
    try {
      if (p) {
        await api(`/stock/purchases/${p.id}`, { method: 'PUT', body });
        setMsg({ tone: 'success', text: 'Compra guardada.' });
        res.reload();
      } else navigate(`/stock/compras/${(await api<Purchase>('/stock/purchases', { method: 'POST', body })).id}`, { replace: true });
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    }
  };

  return (
    <>
      <PageHeader
        title={p ? `Compra ${p.number}` : 'Nova compra'}
        actions={p?.status === 'DRAFT' && can('stock.edit') && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal('cancel')}>Cancelar compra</Button>
            <Button onClick={() => setModal('receive')}>Registar recepção</Button>
          </div>
        )}
      />
      <form onSubmit={save} className="space-y-6">
        <Alert tone={msg?.tone}>{msg?.text}</Alert>
        {p && p.status !== 'DRAFT' && <Alert tone="info">Compra {STATUS[p.status].toLowerCase()}{p.receivedAt && ` em ${formatDate(p.receivedAt)}`} - não editável.</Alert>}
        <Card className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Fornecedor"><SupplierSelect value={supplier} onChange={setSupplier} disabled={!editable} /></Field>
          <Field label="Armazém de entrada">
            <Select disabled={!editable} value={wh} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
              {whs.data?.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Data prevista"><Input type="date" disabled={!editable} value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} /></Field>
        </Card>
        <Card className="space-y-3 p-5">
          {lines.map((l, i) => (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_120px_140px_140px_auto]">
              <Field label="Artigo"><ItemSelect value={l.item} onChange={(o) => setLine(i, { item: o })} disabled={!editable} /></Field>
              <Field label={`Qtd${l.item?.hint ? ` (${l.item.hint})` : ''}`}><Input type="number" min={0.001} step="any" required disabled={!editable} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></Field>
              <Field label="Custo unit. (Kz)"><Input type="number" min={0} step={1} required disabled={!editable} value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></Field>
              <div className="pb-2 text-right text-sm">{formatKz(Math.round(Number(l.quantity || 0) * Number(l.unitCost || 0)))}</div>
              {editable && <Button type="button" variant="secondary" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</Button>}
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            {editable ? <Button type="button" variant="secondary" onClick={() => setLines([...lines, { item: null, quantity: '', unitCost: '' }])}>+ Linha</Button> : <span />}
            <div><span className="mr-3 text-sm text-slate-500">Total</span><span className="text-lg font-semibold">{formatKz(total)}</span></div>
          </div>
        </Card>
        <Card className="p-5"><Field label="Notas"><Textarea disabled={!editable} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></Card>
        {editable && <div className="flex justify-end"><Button type="submit">{p ? 'Guardar' : 'Criar compra'}</Button></div>}
      </form>
      {modal === 'receive' && p && (
        <ConfirmModal title="Registar recepção" message={`Dá entrada em stock de ${p.lines.length} artigo(s): ${p.lines.map((l) => `${formatQty(l.quantity)} ${l.item.unit} ${l.item.code}`).join(', ')}. O custo médio é recalculado.`}
          onClose={() => setModal(null)} onConfirm={async () => { await api(`/stock/purchases/${p.id}/receive`, { method: 'POST' }); res.reload(); setMsg({ tone: 'success', text: 'Recepção registada. Stock actualizado.' }); }} />
      )}
      {modal === 'cancel' && p && <ConfirmModal title="Cancelar compra" danger onClose={() => setModal(null)} onConfirm={async () => { await api(`/stock/purchases/${p.id}/cancel`, { method: 'POST' }); res.reload(); }} />}
    </>
  );
}
