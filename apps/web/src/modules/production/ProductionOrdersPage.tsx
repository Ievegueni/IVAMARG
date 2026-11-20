import { formatDate, PO_STATUS, PRIORITY } from '@ivamarg/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, Input, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { toQuery } from '../../lib/api';
import { useApi, type Page } from '../../lib/useApi';

type Row = { id: string; number: string; status: keyof typeof PO_STATUS; quantity: number; createdAt: string; _count: { lots: number }; order: { number: string; deadline: string | null; priority: keyof typeof PRIORITY; client: { name: string } } };
export const poTone = (s: keyof typeof PO_STATUS) => (s === 'COMPLETED' ? 'green' : s === 'RELEASED' ? 'amber' : s === 'CANCELLED' ? 'red' : 'slate');

export function ProductionOrdersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: '' });
  const list = useApi<Page<Row>>(`/production/orders${toQuery({ page, ...f })}`);
  return (
    <>
      <PageHeader title="Ordens de produção" />
      <p className="mb-4 text-sm text-slate-500">As OPs são geradas a partir das encomendas (botão "Gerar ordem de produção" na encomenda).</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="OP, encomenda ou cliente…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}>
          <option value="">Todos os estados</option>
          {Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['OP', 'Encomenda', 'Cliente', 'Peças', 'Lotes', 'Prazo', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/producao/ops/${p.id}`)}>
              <Td className="font-medium">{p.number}</Td>
              <Td>{p.order.number}</Td>
              <Td>{p.order.client.name}</Td>
              <Td className="text-right">{p.quantity}</Td>
              <Td className="text-right">{p._count.lots || '-'}</Td>
              <Td className="whitespace-nowrap">{p.order.deadline ? formatDate(p.order.deadline) : '-'}{(p.order.priority === 'URGENT' || p.order.priority === 'HIGH') && <span className="ml-2"><Badge tone="amber">{PRIORITY[p.order.priority]}</Badge></span>}</Td>
              <Td><Badge tone={poTone(p.status)}>{PO_STATUS[p.status]}</Badge></Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </>
  );
}
