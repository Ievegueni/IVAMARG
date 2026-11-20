import { formatDate, formatDateTime, formatKz, needsApproval, PROPOSAL_STATUS, proposalTotal, type ProposalStatus } from '@ivamarg/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { api, openFile } from '../../lib/api';
import { errMsg, toDateInput } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { ItemsEditor, type Item } from './ItemsEditor';
import { DocumentsPanel } from '../documents/DocumentsPage';
import { IssueInvoiceButton } from '../invoices/InvoicesPage';
import { statusTone } from './ProposalsPage';

type Version = {
  id: string;
  version: number;
  notes: string | null;
  validUntil: string | null;
  total: number;
  sentAt: string | null;
  createdAt: string;
  items: { description: string; quantity: string; unitPrice: number; discountPct: string; total: number }[];
  approvals: { id: string; decision: string; comment: string | null; createdAt: string; approver: { name: string } }[];
};
type Ref = { id: string; number: string } | null;
type Proposal = {
  id: string;
  number: string;
  title: string;
  status: ProposalStatus;
  mode: 'ITEMS' | 'PHASES';
  total: number;
  currentVersion: number;
  declineReason: string | null;
  approvalThreshold: number;
  client: { id: string; name: string };
  owner: { name: string } | null;
  businessLine: { name: string };
  opportunity: { id: string; title: string } | null;
  versions: Version[];
  order: Ref;
  contract: Ref;
  project: Ref;
  borehole: Ref;
};

const toItems = (v: Version): Item[] =>
  v.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: i.unitPrice, discountPct: Number(i.discountPct) }));

export function ProposalDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const res = useApi<Proposal>(`/proposals/${id}`);
  const [p, setP] = useState<Proposal>();
  const [viewVersion, setViewVersion] = useState<number>();
  const [draft, setDraft] = useState<{ title: string; items: Item[]; notes: string; validUntil: string }>();
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const [modal, setModal] = useState<'approve' | 'reject' | 'decline' | 'accept' | null>(null);

  useEffect(() => { if (res.data) load(res.data); }, [res.data]);
  const load = (data: Proposal) => {
    setP(data);
    setViewVersion(data.currentVersion);
    const cur = data.versions.find((v) => v.version === data.currentVersion)!;
    setDraft({ title: data.title, items: toItems(cur), notes: cur.notes ?? '', validUntil: toDateInput(cur.validUntil) });
    setDirty(false);
  };

  if (res.error) return <Alert>{res.error}</Alert>;
  if (!p || !draft) return <div className="text-slate-500">A carregar…</div>;

  const shown = p.versions.find((v) => v.version === viewVersion)!;
  const isCurrent = viewVersion === p.currentVersion;
  const editable = isCurrent && can('pipeline.edit') && (p.status === 'DRAFT' || p.status === 'REJECTED');
  const draftTotal = proposalTotal(draft.items);
  const approvalNeeded = needsApproval(editable ? draftTotal : p.total, p.approvalThreshold);
  const generated = [p.order && ['Encomenda', p.order, `/encomendas/${p.order.id}`], p.contract && ['Contrato', p.contract, `/contratos?open=${p.contract.id}`], p.project && ['Obra', p.project, null], p.borehole && ['Furo', p.borehole, null]].filter(Boolean) as [string, { number: string }, string | null][];

  const act = async (path: string, body?: unknown, ok?: string) => {
    setMsg(undefined);
    try {
      load(await api<Proposal>(`/proposals/${id}/${path}`, { method: path === 'draft' ? 'PUT' : 'POST', body }));
      if (ok) setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
      throw e;
    }
  };
  const save = () => act('draft', { ...draft, validUntil: draft.validUntil || null }, 'Alterações guardadas.').catch(() => {});
  const edit = (d: Partial<typeof draft>) => { setDraft({ ...draft, ...d }); setDirty(true); };

  return (
    <>
      <PageHeader
        title={`${p.number} - ${p.title}`}
        actions={<Button variant="secondary" onClick={() => openFile(`/proposals/${id}/pdf?version=${viewVersion}`).catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))}>PDF v{viewVersion}</Button>}
      />
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text}</Alert></div>

      <Card className="mb-6 grid grid-cols-2 gap-4 p-5 text-sm lg:grid-cols-4">
        <div><div className="text-xs text-slate-500">Cliente</div><Link className="text-brand-600 hover:underline" to={`/clientes/${p.client.id}`}>{p.client.name}</Link></div>
        <div><div className="text-xs text-slate-500">Linha de negócio</div>{p.businessLine.name}</div>
        <div><div className="text-xs text-slate-500">Estado</div><Badge tone={statusTone(p.status)}>{PROPOSAL_STATUS[p.status]}</Badge></div>
        <div><div className="text-xs text-slate-500">Comercial</div>{p.owner?.name ?? '-'}</div>
        {p.opportunity && <div><div className="text-xs text-slate-500">Oportunidade</div>{p.opportunity.title}</div>}
        {p.declineReason && <div className="sm:col-span-2"><div className="text-xs text-slate-500">Motivo da recusa</div>{p.declineReason}</div>}
        {generated.map(([label, ref, link]) => (
          <div key={label}><div className="text-xs text-slate-500">{label} gerada</div>{link ? <Link className="text-brand-600 hover:underline" to={link}>{ref.number}</Link> : ref.number}</div>
        ))}
      </Card>

      {/* Acções conforme o estado */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {editable && dirty && <Button onClick={save}>Guardar alterações</Button>}
        {!dirty && isCurrent && can('pipeline.edit') && (
          <>
            {p.status === 'DRAFT' && approvalNeeded && <Button onClick={() => act('submit', undefined, 'Submetida para aprovação. Os aprovadores foram notificados.').catch(() => {})}>Submeter para aprovação</Button>}
            {((p.status === 'DRAFT' && !approvalNeeded) || p.status === 'APPROVED') && (
              <Button onClick={() => act('send', undefined, 'Marcada como enviada. Esta versão já não pode ser alterada.').catch(() => {})}>Marcar como enviada ao cliente</Button>
            )}
            {p.status === 'SENT' && (
              <>
                <Button onClick={() => setModal('accept')}>Cliente aceitou</Button>
                <Button variant="secondary" onClick={() => setModal('decline')}>Cliente recusou</Button>
              </>
            )}
            {(p.status === 'SENT' || p.status === 'DECLINED') && <Button variant="secondary" onClick={() => act('new-version', undefined, `Versão ${p.currentVersion + 1} criada.`).catch(() => {})}>Nova versão</Button>}
          </>
        )}
        {p.status === 'ACCEPTED' && !p.order && <IssueInvoiceButton source="Proposal" sourceId={p.id} label={p.number} />}
        {p.status === 'PENDING_APPROVAL' && can('pipeline.approve') && (
          <>
            <Button onClick={() => setModal('approve')}>Aprovar</Button>
            <Button variant="danger" onClick={() => setModal('reject')}>Rejeitar</Button>
          </>
        )}
        {editable && approvalNeeded && (
          <span className="text-xs text-amber-700">Total ≥ {formatKz(p.approvalThreshold)}: precisa de aprovação antes do envio.</span>
        )}
        {p.versions.length > 1 && (
          <Select className="ml-auto w-48" value={viewVersion} onChange={(e) => setViewVersion(Number(e.target.value))}>
            {p.versions.map((v) => <option key={v.version} value={v.version}>Versão {v.version}{v.sentAt ? ' (enviada)' : ''}</option>)}
          </Select>
        )}
      </div>

      {editable && <Card className="mb-6 p-5"><Field label="Título"><Input value={draft.title} onChange={(e) => edit({ title: e.target.value })} /></Field></Card>}
      <Card className="mb-6 p-5">
        <div className="mb-3 text-xs text-slate-500">
          Versão {shown.version} · criada {formatDateTime(shown.createdAt)}
          {shown.sentAt && ` · enviada ${formatDateTime(shown.sentAt)} (imutável)`}
        </div>
        <ItemsEditor items={isCurrent && editable ? draft.items : toItems(shown)} onChange={(items) => edit({ items })} readOnly={!editable} phases={p.mode === 'PHASES'} />
      </Card>
      <Card className="mb-6 grid gap-4 p-5 sm:grid-cols-[1fr_200px]">
        <Field label="Condições / observações">
          {editable ? <Textarea rows={4} value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} /> : <div className="text-sm whitespace-pre-line">{shown.notes || '-'}</div>}
        </Field>
        <Field label="Válida até">
          {editable ? <Input type="date" value={draft.validUntil} onChange={(e) => edit({ validUntil: e.target.value })} /> : <div className="text-sm">{shown.validUntil ? formatDate(shown.validUntil) : '-'}</div>}
        </Field>
      </Card>

      <div className="mb-6"><h3 className="mb-2 text-sm font-semibold">Documentos</h3><DocumentsPanel entity="Proposal" entityId={p.id} /></div>
      {shown.approvals.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Aprovações</h3>
          <ul className="space-y-2 text-sm">
            {shown.approvals.map((a) => (
              <li key={a.id}>
                <Badge tone={a.decision === 'APPROVED' ? 'green' : 'red'}>{a.decision === 'APPROVED' ? 'Aprovada' : 'Rejeitada'}</Badge>{' '}
                por {a.approver.name} em {formatDateTime(a.createdAt)}{a.comment && <span className="text-slate-600"> - {a.comment}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal === 'approve' && <ConfirmModal title="Aprovar proposta" message={`${p.client.name} - ${formatKz(p.total)}`} label="Comentário (opcional)" onClose={() => setModal(null)} onConfirm={(c) => act('approve', { comment: c }, 'Proposta aprovada.')} />}
      {modal === 'reject' && <ConfirmModal title="Rejeitar proposta" label="Motivo (obrigatório)" required danger onClose={() => setModal(null)} onConfirm={(c) => act('reject', { comment: c }, 'Proposta rejeitada.')} />}
      {modal === 'decline' && <ConfirmModal title="Cliente recusou" label="Motivo (opcional)" danger onClose={() => setModal(null)} onConfirm={(c) => act('decline', { comment: c })} />}
      {modal === 'accept' && (
        <ConfirmModal
          title="Cliente aceitou a proposta"
          message={<>Será criado automaticamente o registo correspondente à linha <b>{p.businessLine.name}</b> (encomenda, obra, furo ou contrato).</>}
          onClose={() => setModal(null)}
          onConfirm={() => act('accept', undefined, 'Proposta aceite. Registo operacional criado.')}
        />
      )}
    </>
  );
}
