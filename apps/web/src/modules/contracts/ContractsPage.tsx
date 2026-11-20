import { CONTRACT_STATUS, formatDate, formatKz, PERIODICITY } from '@ivamarg/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ClientSelect } from '../../components/ClientSelect';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, localDate, toDateInput } from '../../lib/format';
import { useApi, type Page } from '../../lib/useApi';
import { DocumentsPanel } from '../documents/DocumentsPage';
import { IssueInvoiceButton } from '../invoices/InvoicesPage';

type Contract = {
  id: string;
  number: string;
  title: string;
  startDate: string;
  endDate: string | null;
  value: number;
  periodicity: keyof typeof PERIODICITY;
  autoRenew: boolean;
  renewalNoticeDays: number;
  status: keyof typeof CONTRACT_STATUS;
  notes: string | null;
  client: { id: string; name: string };
  proposal: { id: string; number: string } | null;
};

export function ContractsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const list = useApi<Page<Contract>>(`/contracts${toQuery({ page, search })}`);
  const [editing, setEditing] = useState<Contract | 'new' | null>(null);

  // Abrir directamente um contrato (?open=id) - usado a partir da proposta / ficha do cliente.
  useEffect(() => {
    const openId = params.get('open');
    if (openId) api<Contract>(`/contracts/${openId}`).then(setEditing).catch(() => {}).finally(() => setParams({}, { replace: true }));
  }, [params, setParams]);

  return (
    <>
      <PageHeader title="Contratos" actions={can('pipeline.create') && <Button onClick={() => setEditing('new')}>Novo contrato</Button>} />
      <Input className="mb-4 max-w-sm" placeholder="Pesquisar número, título, cliente…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', 'Cliente', 'Título', 'Período', 'Valor', 'Renovação', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(c)}>
              <Td className="font-medium">{c.number}</Td>
              <Td>{c.client.name}</Td>
              <Td>{c.title}</Td>
              <Td className="whitespace-nowrap">{formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : 'indeterminado'}</Td>
              <Td className="whitespace-nowrap">{formatKz(c.value)} / {PERIODICITY[c.periodicity].toLowerCase()}</Td>
              <Td>{c.autoRenew ? 'Automática' : 'Manual'}</Td>
              <Td><Badge tone={c.status === 'ACTIVE' ? 'green' : 'slate'}>{CONTRACT_STATUS[c.status]}</Badge></Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {editing && <ContractForm contract={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function ContractForm({ contract, onClose, onSaved }: { contract: Contract | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const editable = contract ? can('pipeline.edit') : can('pipeline.create');
  const [client, setClient] = useState(contract?.client ?? null);
  const [f, setF] = useState({
    title: contract?.title ?? '',
    startDate: toDateInput(contract?.startDate) || localDate(),
    endDate: toDateInput(contract?.endDate),
    value: contract?.value ?? 0,
    periodicity: contract?.periodicity ?? 'MONTHLY',
    autoRenew: contract?.autoRenew ?? false,
    renewalNoticeDays: contract?.renewalNoticeDays ?? 30,
    status: contract?.status ?? 'ACTIVE',
    notes: contract?.notes ?? '',
  });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return setError('Seleccione o cliente');
    const body = { ...f, clientId: client.id, endDate: f.endDate || null };
    try {
      await api(contract ? `/contracts/${contract.id}` : '/contracts', { method: contract ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={contract ? `Contrato ${contract.number}` : 'Novo contrato'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Cliente"><ClientSelect value={client} onChange={setClient} disabled={!!contract} /></Field>
        <Field label="Título"><Input required disabled={!editable} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Início"><Input type="date" required disabled={!editable} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Fim (vazio = indeterminado)"><Input type="date" disabled={!editable} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Valor por período (Kz)"><Input type="number" min={0} step={1} disabled={!editable} value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></Field>
          <Field label="Periodicidade">
            <Select disabled={!editable} value={f.periodicity} onChange={(e) => setF({ ...f, periodicity: e.target.value as Contract['periodicity'] })}>
              {Object.entries(PERIODICITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Aviso de renovação (dias antes)"><Input type="number" min={0} disabled={!editable} value={f.renewalNoticeDays} onChange={(e) => setF({ ...f, renewalNoticeDays: Number(e.target.value) })} /></Field>
          <Field label="Estado">
            <Select disabled={!editable} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Contract['status'] })}>
              {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={!editable} checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} />
          Renovação automática
        </label>
        <Field label="Notas"><Textarea disabled={!editable} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {contract?.proposal && <div className="text-sm text-slate-600">Gerado da proposta <Link className="text-brand-600 hover:underline" to={`/propostas/${contract.proposal.id}`}>{contract.proposal.number}</Link>.</div>}
        {contract && (
          <>
            <div className="flex flex-wrap items-center gap-2">{contract.status === 'ACTIVE' && <IssueInvoiceButton source="Contract" sourceId={contract.id} label={contract.number} />}</div>
            <div><div className="mb-1 text-sm font-medium">Documentos (contrato assinado, anexos)</div><DocumentsPanel entity="Contract" entityId={contract.id} /></div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {editable && <Button type="submit">Guardar</Button>}
        </div>
      </form>
    </Modal>
  );
}
