import { formatDate, formatKz, PROPOSAL_STATUS, type ProposalStatus } from '@ivamarg/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Input, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { toQuery } from '../../lib/api';
import { useApi, type Page } from '../../lib/useApi';

type Row = { id: string; number: string; title: string; status: ProposalStatus; total: number; updatedAt: string; currentVersion: number; client: { name: string }; owner: { name: string } | null; businessLine: { name: string } };

export const statusTone = (s: ProposalStatus) =>
  s === 'ACCEPTED' || s === 'APPROVED' ? 'green' : s === 'REJECTED' || s === 'DECLINED' ? 'red' : s === 'PENDING_APPROVAL' ? 'amber' : 'slate';

export function ProposalsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: '' });
  const list = useApi<Page<Row>>(`/proposals${toQuery({ page, ...f })}`);

  return (
    <>
      <PageHeader title="Propostas" actions={can('pipeline.create') && <Link to="/propostas/nova"><Button>Nova proposta</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Pesquisar número, título, cliente…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}>
          <option value="">Todos os estados</option>
          {Object.entries(PROPOSAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', 'Cliente', 'Título', 'Linha', 'Estado', 'Total', 'Actualizada']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/propostas/${p.id}`)}>
              <Td className="font-medium whitespace-nowrap">{p.number} <span className="text-xs text-slate-400">v{p.currentVersion}</span></Td>
              <Td>{p.client.name}</Td>
              <Td>{p.title}</Td>
              <Td className="text-slate-600">{p.businessLine.name}</Td>
              <Td><Badge tone={statusTone(p.status)}>{PROPOSAL_STATUS[p.status]}</Badge></Td>
              <Td className="text-right whitespace-nowrap">{formatKz(p.total)}</Td>
              <Td className="text-slate-500">{formatDate(p.updatedAt)}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </>
  );
}
