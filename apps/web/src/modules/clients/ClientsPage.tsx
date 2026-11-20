import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Input, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { toQuery } from '../../lib/api';
import { formatPhone } from '../../lib/format';
import { useBusinessLines, useUserOptions } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';
import { ClientForm, type Client } from './ClientForm';

export function ClientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', businessLineId: '', ownerId: '' });
  const clients = useApi<Page<Client>>(`/clients${toQuery({ page, ...f })}`);
  const lines = useBusinessLines();
  const users = useUserOptions();
  const [creating, setCreating] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader
        title="Clientes"
        actions={can('clients.create') && (
          <div className="flex gap-2">
            <Link to="/clientes/importar"><Button variant="secondary">Importar</Button></Link>
            <Button onClick={() => setCreating(true)}>Novo cliente</Button>
          </div>
        )}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Pesquisar nome, NIF, email, telefone…" value={f.search} onChange={set('search')} />
        <Select value={f.businessLineId} onChange={set('businessLineId')}>
          <option value="">Todas as linhas de negócio</option>
          {lines.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        {can('clients.viewAll') && (
          <Select value={f.ownerId} onChange={set('ownerId')}>
            <option value="">Todos os comerciais</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
      </div>
      <Alert>{clients.error}</Alert>
      <Card>
        <Table head={['Nome', 'NIF', 'Contacto', 'Linhas', 'Responsável']} empty={clients.data?.items.length === 0}>
          {clients.data?.items.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/clientes/${c.id}`)}>
              <Td className="font-medium">
                {c.name}
                {c.tags.map((t) => <span key={t} className="ml-2"><Badge>{t}</Badge></span>)}
              </Td>
              <Td>{c.nif ?? '-'}</Td>
              <Td className="text-slate-600">{[c.phones[0] && formatPhone(c.phones[0]), c.email].filter(Boolean).join(' · ') || '-'}</Td>
              <Td className="text-slate-600">{c.businessLines.map((b) => b.name).join(', ') || '-'}</Td>
              <Td>{c.owner?.name ?? '-'}</Td>
            </tr>
          ))}
        </Table>
        {clients.data && <Pagination {...clients.data} onPage={setPage} />}
      </Card>
      {creating && <ClientForm client={null} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/clientes/${c.id}`)} />}
    </>
  );
}
