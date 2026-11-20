import { formatDateTime } from '@ivamarg/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, formatQty } from '../../lib/format';
import { useWarehouses } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';

const STATUS = { OPEN: 'Em contagem', SUBMITTED: 'Aguarda aprovação', APPROVED: 'Aprovado', CANCELLED: 'Cancelado' } as const;
type Count = { id: string; number: string; status: keyof typeof STATUS; warehouseName?: string; createdAt: string; approvedAt: string | null };
type Detail = Count & { lines: { itemId: string; expected: string; counted: string | null; item: { code: string; name: string; unit: string } }[] };

export function InventoriesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const list = useApi<Page<Count>>(`/stock/inventories?page=${page}`);
  const whs = useWarehouses();
  const [opening, setOpening] = useState(false);
  const [wh, setWh] = useState('');
  const [error, setError] = useState('');
  const open = async () => {
    try {
      const c = await api<Count>('/stock/inventories', { method: 'POST', body: { warehouseId: wh || whs.data?.[0]?.id } });
      navigate(`/stock/inventarios/${c.id}`);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <>
      <PageHeader title="Inventários" actions={can('stock.create') && <Button onClick={() => setOpening(true)}>Nova contagem</Button>} />
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', 'Armazém', 'Estado', 'Aberto', 'Aprovado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/stock/inventarios/${c.id}`)}>
              <Td className="font-medium">{c.number}</Td><Td>{c.warehouseName}</Td>
              <Td><Badge tone={c.status === 'APPROVED' ? 'green' : c.status === 'SUBMITTED' ? 'amber' : 'slate'}>{STATUS[c.status]}</Badge></Td>
              <Td>{formatDateTime(c.createdAt)}</Td><Td>{c.approvedAt ? formatDateTime(c.approvedAt) : '-'}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {opening && (
        <Modal open title="Nova contagem de inventário" onClose={() => setOpening(false)}>
          <div className="space-y-4">
            <Alert>{error}</Alert>
            <Field label="Armazém">
              <Select value={wh || whs.data?.[0]?.id} onChange={(e) => setWh(e.target.value)}>
                {whs.data?.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <p className="text-sm text-slate-500">É registado o físico actual de cada artigo. Depois de contar, submeta para aprovação; a aprovação gera os ajustes.</p>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpening(false)}>Cancelar</Button><Button onClick={open}>Abrir contagem</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function InventoryDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const res = useApi<Detail>(`/stock/inventories/${id}`);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const [modal, setModal] = useState<'approve' | 'cancel' | null>(null);
  const c = res.data;
  useEffect(() => { if (c) setCounts(Object.fromEntries(c.lines.map((l) => [l.itemId, l.counted == null ? '' : String(Number(l.counted))]))); }, [c]);
  if (res.error) return <Alert>{res.error}</Alert>;
  if (!c) return <div className="text-slate-500">A carregar…</div>;

  const editable = c.status === 'OPEN' && can('stock.edit');
  const body = () => ({ lines: c.lines.map((l) => ({ itemId: l.itemId, counted: counts[l.itemId] === '' ? null : Number(counts[l.itemId]) })) });
  const act = async (path: string, method: 'PUT' | 'POST', ok: string, withBody = true) => {
    setMsg(undefined);
    try {
      await api(`/stock/inventories/${id}${path}`, { method, body: withBody ? body() : undefined });
      setMsg({ tone: 'success', text: ok });
      res.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  const diffs = c.lines.filter((l) => counts[l.itemId] !== '' && Number(counts[l.itemId]) !== Number(l.expected));
  const shown = c.lines.filter((l) => !filter || `${l.item.code} ${l.item.name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <PageHeader title={`Inventário ${c.number}`} actions={<Badge tone={c.status === 'APPROVED' ? 'green' : 'slate'}>{STATUS[c.status]}</Badge>} />
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text}</Alert></div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Filtrar artigos…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-sm text-slate-500">{diffs.length} diferença(s)</span>
        <div className="ml-auto flex gap-2">
          {editable && <Button variant="secondary" onClick={() => act('', 'PUT', 'Contagens guardadas.')}>Guardar</Button>}
          {editable && <Button onClick={() => act('/submit', 'POST', 'Submetido para aprovação.')}>Submeter</Button>}
          {c.status === 'SUBMITTED' && can('stock.approve') && <Button onClick={() => setModal('approve')}>Aprovar e ajustar</Button>}
          {['OPEN', 'SUBMITTED'].includes(c.status) && can('stock.edit') && <Button variant="secondary" onClick={() => setModal('cancel')}>Cancelar</Button>}
        </div>
      </div>
      <Card>
        <Table head={['Código', 'Artigo', 'Esperado', 'Contado', 'Diferença']}>
          {shown.map((l) => {
            const d = counts[l.itemId] === '' ? null : Number(counts[l.itemId]) - Number(l.expected);
            return (
              <tr key={l.itemId}>
                <Td className="font-mono text-xs">{l.item.code}</Td>
                <Td>{l.item.name}</Td>
                <Td className="text-right whitespace-nowrap">{formatQty(l.expected)} {l.item.unit}</Td>
                <Td className="w-36">{editable ? <Input type="number" min={0} step="any" className="text-right" value={counts[l.itemId] ?? ''} onChange={(e) => setCounts({ ...counts, [l.itemId]: e.target.value })} /> : <div className="text-right">{l.counted == null ? '-' : formatQty(l.counted)}</div>}</Td>
                <Td className={`text-right ${d ? (d < 0 ? 'text-red-600' : 'text-green-700') : 'text-slate-400'}`}>{d == null ? '-' : d === 0 ? '0' : `${d > 0 ? '+' : ''}${formatQty(d)}`}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      {modal === 'approve' && <ConfirmModal title="Aprovar inventário" message={`Serão criados ${diffs.length} ajuste(s) de stock.`} onClose={() => setModal(null)} onConfirm={() => act('/approve', 'POST', 'Inventário aprovado e stock ajustado.', false)} />}
      {modal === 'cancel' && <ConfirmModal title="Cancelar inventário" danger onClose={() => setModal(null)} onConfirm={() => act('/cancel', 'POST', 'Cancelado.', false)} />}
    </>
  );
}
