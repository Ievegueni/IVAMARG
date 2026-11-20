import { formatDate, formatKz, ORDER_STATUS, PRIORITY } from '@ivamarg/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Input, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { toQuery } from '../../lib/api';
import { useApi, type Page } from '../../lib/useApi';

type Row = { id: string; number: string; status: keyof typeof ORDER_STATUS; priority: keyof typeof PRIORITY; deadline: string | null; total: number; client: { name: string } };

export function OrdersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: '' });
  const list = useApi<Page<Row>>(`/orders${toQuery({ page, ...f })}`);
  return (
    <>
      <PageHeader title="Encomendas" actions={can('production.create') && <Link to="/encomendas/nova"><Button>Nova encomenda</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Pesquisar número ou cliente…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}>
          <option value="">Todos os estados</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', 'Cliente', 'Estado', 'Prioridade', 'Prazo', 'Total']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/encomendas/${o.id}`)}>
              <Td className="font-medium">{o.number}</Td>
              <Td>{o.client.name}</Td>
              <Td><Badge tone={o.status === 'DELIVERED' ? 'green' : o.status === 'CANCELLED' ? 'red' : 'slate'}>{ORDER_STATUS[o.status]}</Badge></Td>
              <Td>{o.priority === 'URGENT' || o.priority === 'HIGH' ? <Badge tone="amber">{PRIORITY[o.priority]}</Badge> : PRIORITY[o.priority]}</Td>
              <Td>{o.deadline ? formatDate(o.deadline) : '-'}</Td>
              <Td className="text-right">{formatKz(o.total)}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </>
  );
}
