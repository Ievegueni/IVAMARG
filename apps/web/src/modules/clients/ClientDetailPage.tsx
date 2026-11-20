import { formatDate, formatDateTime, formatKz, INTERACTION_TYPES, ORDER_STATUS, PERIODICITY, PROPOSAL_STATUS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Pagination, Select, Table, Tabs, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatPhone } from '../../lib/format';
import { useApi, type Page } from '../../lib/useApi';
import { ClientConversations } from '../communication/ClientConversations';
import { DocumentsPanel } from '../documents/DocumentsPage';
import { ClientForm, type Client } from './ClientForm';

type Contact = { id: string; name: string; role: string | null; phone: string | null; email: string | null; isPrimary: boolean };
type Event = { id: string; type: string; title: string; body: string | null; occurredAt: string; userName: string | null };

export function ClientDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const navigate = useNavigate();
  const client = useApi<Client & { contacts: Contact[] }>(`/clients/${id}`);
  const [tab, setTab] = useState<'timeline' | 'contacts' | 'opps' | 'proposals' | 'orders' | 'contracts' | 'docs' | 'msgs'>('timeline');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const c = client.data;

  if (client.error) return <Alert>{client.error}</Alert>;
  if (!c) return <div className="text-slate-500">A carregar…</div>;

  return (
    <>
      <PageHeader
        title={c.name}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('pipeline.create') && <Link to={`/propostas/nova${toQuery({ clientId: c.id })}`}><Button variant="secondary">Nova proposta</Button></Link>}
            {can('clients.edit') && <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}
            {can('clients.delete') && <Button variant="danger" onClick={() => setDeleting(true)}>Eliminar</Button>}
          </div>
        }
      />
      <Card className="mb-6 grid grid-cols-2 gap-4 p-5 text-sm lg:grid-cols-4">
        <Info label="NIF">{c.nif}</Info>
        <Info label="Telefone(s)">{c.phones.map(formatPhone).join(', ')}</Info>
        <Info label="Email">{c.email}</Info>
        <Info label="Responsável">{c.owner?.name}</Info>
        <Info label="Morada">{c.address}</Info>
        <Info label="Linhas de negócio">{c.businessLines.map((b) => b.name).join(', ')}</Info>
        <Info label="Tags">{c.tags.length ? c.tags.map((t) => <span key={t} className="mr-1"><Badge>{t}</Badge></span>) : null}</Info>
        <Info label="Notas">{c.notes}</Info>
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[['timeline', 'Histórico'], ['contacts', `Contactos (${c.contacts.length})`], ['opps', 'Oportunidades'], ['proposals', 'Propostas'], ['orders', 'Encomendas'], ['contracts', 'Contratos'], ['docs', 'Documentos'], ['msgs', 'Conversas']]}
      />
      {tab === 'timeline' && <Timeline clientId={id} />}
      {tab === 'contacts' && <Contacts clientId={id} contacts={c.contacts} reload={client.reload} />}
      {tab === 'opps' && <RelatedOpps clientId={id} />}
      {tab === 'proposals' && <RelatedProposals clientId={id} />}
      {tab === 'orders' && <RelatedOrders clientId={id} />}
      {tab === 'contracts' && <RelatedContracts clientId={id} />}
      {tab === 'docs' && <DocumentsPanel entity="Client" entityId={id} />}
      {tab === 'msgs' && <ClientConversations clientId={id} phones={c.phones} email={c.email} />}
      {editing && <ClientForm client={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); client.reload(); }} />}
      {deleting && (
        <ConfirmModal title="Eliminar cliente" danger message={`O cliente "${c.name}" deixa de aparecer nas listagens. O histórico é mantido.`}
          onClose={() => setDeleting(false)} onConfirm={async () => { await api(`/clients/${id}`, { method: 'DELETE' }); navigate('/clientes'); }} />
      )}
    </>
  );
}

const Info = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-xs text-slate-500">{label}</div>
    <div className="mt-0.5">{children || '-'}</div>
  </div>
);

function Timeline({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const events = useApi<Page<Event>>(`/clients/${clientId}/timeline${toQuery({ page })}`);
  const [f, setF] = useState({ type: 'NOTE', title: '', body: '' });
  const [error, setError] = useState('');

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/clients/${clientId}/interactions`, { method: 'POST', body: f });
      setF({ type: 'NOTE', title: '', body: '' });
      setError('');
      events.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        <ol className="space-y-4">
          {events.data?.items.length === 0 && <li className="text-sm text-slate-500">Sem eventos.</li>}
          {events.data?.items.map((ev) => (
            <li key={ev.id} className="border-l-2 border-slate-200 pl-4">
              <div className="text-xs text-slate-500">
                {formatDateTime(ev.occurredAt)} · {INTERACTION_TYPES[ev.type as keyof typeof INTERACTION_TYPES] ?? (ev.type === 'MESSAGE' ? 'Mensagem' : 'Sistema')}
                {ev.userName && ` · ${ev.userName}`}
              </div>
              <div className="text-sm font-medium">{ev.title}</div>
              {ev.body && <div className="text-sm whitespace-pre-line text-slate-600">{ev.body}</div>}
            </li>
          ))}
        </ol>
        {events.data && events.data.total > events.data.pageSize && <Pagination {...events.data} onPage={setPage} />}
      </Card>
      {can('clients.edit') && (
        <Card className="h-fit p-5">
          <h3 className="mb-3 text-sm font-semibold">Registar interacção</h3>
          <form onSubmit={add} className="space-y-3">
            <Alert>{error}</Alert>
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(INTERACTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Input required placeholder="Resumo" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <Textarea placeholder="Detalhe (opcional)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            <Button type="submit" className="w-full">Registar</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function Contacts({ clientId, contacts, reload }: { clientId: string; contacts: Contact[]; reload: () => void }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  return (
    <Card>
      {can('clients.edit') && <div className="flex justify-end p-3"><Button variant="secondary" onClick={() => setEditing('new')}>Novo contacto</Button></div>}
      <Table head={['Nome', 'Função', 'Telefone', 'Email', '']} empty={contacts.length === 0}>
        {contacts.map((ct) => (
          <tr key={ct.id}>
            <Td className="font-medium">{ct.name}{ct.isPrimary && <span className="ml-2"><Badge tone="green">Principal</Badge></span>}</Td>
            <Td>{ct.role ?? '-'}</Td>
            <Td>{ct.phone ?? '-'}</Td>
            <Td>{ct.email ?? '-'}</Td>
            <Td className="space-x-3 text-right whitespace-nowrap">
              {can('clients.edit') && (
                <>
                  <button className="text-brand-600 hover:underline" onClick={() => setEditing(ct)}>Editar</button>
                  <button className="text-red-600 hover:underline" onClick={() => setRemoving(ct)}>Remover</button>
                </>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {editing && <ContactForm clientId={clientId} contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {removing && <ConfirmModal title="Remover contacto" message={`Remover ${removing.name}?`} danger onClose={() => setRemoving(null)}
        onConfirm={async () => { await api(`/clients/${clientId}/contacts/${removing.id}`, { method: 'DELETE' }); reload(); }} />}
    </Card>
  );
}

function ContactForm({ clientId, contact, onClose, onSaved }: { clientId: string; contact: Contact | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: contact?.name ?? '', role: contact?.role ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '', isPrimary: contact?.isPrimary ?? false });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(contact ? `/clients/${clientId}/contacts/${contact.id}` : `/clients/${clientId}/contacts`, { method: contact ? 'PATCH' : 'POST', body: f });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={contact ? 'Editar contacto' : 'Novo contacto'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Função"><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telefone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />
          Contacto principal
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}

function RelatedOpps({ clientId }: { clientId: string }) {
  const r = useApi<{ id: string; title: string; value: number; stage: { name: string }; owner: { name: string } | null }[]>(`/opportunities?clientId=${clientId}`);
  return (
    <Card>
      <Table head={['Oportunidade', 'Estado', 'Valor', 'Comercial']} empty={r.data?.length === 0}>
        {r.data?.map((o) => (
          <tr key={o.id}><Td className="font-medium">{o.title}</Td><Td>{o.stage.name}</Td><Td>{formatKz(o.value)}</Td><Td>{o.owner?.name ?? '-'}</Td></tr>
        ))}
      </Table>
    </Card>
  );
}

function RelatedProposals({ clientId }: { clientId: string }) {
  const r = useApi<Page<{ id: string; number: string; title: string; status: keyof typeof PROPOSAL_STATUS; total: number }>>(`/proposals?clientId=${clientId}&pageSize=100`);
  return (
    <Card>
      <Table head={['Número', 'Título', 'Estado', 'Total']} empty={r.data?.items.length === 0}>
        {r.data?.items.map((p) => (
          <tr key={p.id}><Td><Link className="text-brand-600 hover:underline" to={`/propostas/${p.id}`}>{p.number}</Link></Td><Td>{p.title}</Td><Td>{PROPOSAL_STATUS[p.status]}</Td><Td>{formatKz(p.total)}</Td></tr>
        ))}
      </Table>
    </Card>
  );
}

function RelatedOrders({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const r = useApi<Page<{ id: string; number: string; status: keyof typeof ORDER_STATUS; deadline: string | null; total: number }>>(can('production.view') ? `/orders?clientId=${clientId}&pageSize=100` : null);
  if (!can('production.view')) return <Alert tone="info">Sem permissão para ver encomendas.</Alert>;
  return (
    <Card>
      <Table head={['Número', 'Estado', 'Prazo', 'Total']} empty={r.data?.items.length === 0}>
        {r.data?.items.map((o) => (
          <tr key={o.id}><Td><Link className="text-brand-600 hover:underline" to={`/encomendas/${o.id}`}>{o.number}</Link></Td><Td>{ORDER_STATUS[o.status]}</Td><Td>{o.deadline ? formatDate(o.deadline) : '-'}</Td><Td>{formatKz(o.total)}</Td></tr>
        ))}
      </Table>
    </Card>
  );
}

function RelatedContracts({ clientId }: { clientId: string }) {
  const r = useApi<Page<{ id: string; number: string; title: string; periodicity: keyof typeof PERIODICITY; value: number; startDate: string }>>(`/contracts?clientId=${clientId}&pageSize=100`);
  return (
    <Card>
      <Table head={['Número', 'Título', 'Início', 'Valor']} empty={r.data?.items.length === 0}>
        {r.data?.items.map((c) => (
          <tr key={c.id}><Td><Link className="text-brand-600 hover:underline" to={`/contratos?open=${c.id}`}>{c.number}</Link></Td><Td>{c.title}</Td><Td>{formatDate(c.startDate)}</Td><Td>{formatKz(c.value)} / {PERIODICITY[c.periodicity].toLowerCase()}</Td></tr>
        ))}
      </Table>
    </Card>
  );
}
