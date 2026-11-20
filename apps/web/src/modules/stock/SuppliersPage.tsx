import { useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Pagination, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useApi, type Page } from '../../lib/useApi';

type Supplier = { id: string; name: string; nif: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null };

export function SuppliersPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const list = useApi<Page<Supplier>>(`/stock/suppliers${toQuery({ page, search })}`);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  return (
    <>
      <PageHeader title="Fornecedores" actions={can('stock.create') && <Button onClick={() => setEditing('new')}>Novo fornecedor</Button>} />
      <Input className="mb-4 max-w-sm" placeholder="Pesquisar…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Nome', 'NIF', 'Telefone', 'Email']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(s)}>
              <Td className="font-medium">{s.name}</Td><Td>{s.nif ?? '-'}</Td><Td>{s.phone ?? '-'}</Td><Td>{s.email ?? '-'}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {editing && <SupplierForm s={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function SupplierForm({ s, onClose, onSaved }: { s: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const [f, setF] = useState({ name: s?.name ?? '', nif: s?.nif ?? '', phone: s?.phone ?? '', email: s?.email ?? '', address: s?.address ?? '', notes: s?.notes ?? '' });
  const [error, setError] = useState('');
  const editable = s ? can('stock.edit') : can('stock.create');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(s ? `/stock/suppliers/${s.id}` : '/stock/suppliers', { method: s ? 'PATCH' : 'POST', body: f });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <Field label={label}><Input type={type} disabled={!editable} required={k === 'name'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <Modal open title={s ? s.name : 'Novo fornecedor'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {field('name', 'Nome')}
        <div className="grid gap-4 sm:grid-cols-3">{field('nif', 'NIF')}{field('phone', 'Telefone')}{field('email', 'Email', 'email')}</div>
        {field('address', 'Morada')}
        <Field label="Notas"><Textarea disabled={!editable} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {editable && <Button type="submit">Guardar</Button>}
        </div>
      </form>
    </Modal>
  );
}
