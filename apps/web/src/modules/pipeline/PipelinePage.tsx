import { formatDate, formatKz, LEAD_SOURCES } from '@ivamarg/shared';
import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ClientSelect } from '../../components/ClientSelect';
import { Alert, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Select, Tabs, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, toDateInput } from '../../lib/format';
import { useBusinessLines, useUserOptions, type Stage } from '../../lib/options';
import { useApi } from '../../lib/useApi';

export type Opp = {
  id: string;
  title: string;
  value: number;
  stageId: string;
  businessLineId: string;
  expectedCloseAt: string | null;
  source: string | null;
  lostReason: string | null;
  notes: string | null;
  ownerId: string | null;
  client: { id: string; name: string };
  owner: { id: string; name: string } | null;
};

export function PipelinePage() {
  const { can } = useAuth();
  const lines = useBusinessLines();
  const users = useUserOptions();
  const active = lines.data?.filter((l) => l.active) ?? [];
  const [lineId, setLineId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  useEffect(() => {
    if (!lineId && active.length) setLineId(active[0].id);
  }, [active, lineId]);
  const line = active.find((l) => l.id === lineId);
  const stages = line?.pipelineStages.filter((s) => s.active) ?? [];
  const opps = useApi<Opp[]>(lineId ? `/opportunities${toQuery({ businessLineId: lineId, ownerId })}` : null);
  const [editing, setEditing] = useState<Opp | 'new' | null>(null);
  const [losing, setLosing] = useState<{ opp: Opp; stage: Stage } | null>(null);
  const [error, setError] = useState('');
  const editable = can('pipeline.edit');

  const move = async (opp: Opp, stage: Stage, lostReason?: string) => {
    if (opp.stageId === stage.id) return;
    if (stage.isLost && !lostReason) return setLosing({ opp, stage });
    setError('');
    try {
      await api(`/opportunities/${opp.id}/move`, { method: 'POST', body: { stageId: stage.id, lostReason } });
      opps.reload();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const onDrop = (stage: Stage) => (e: DragEvent) => {
    e.preventDefault();
    const opp = opps.data?.find((o) => o.id === e.dataTransfer.getData('text/plain'));
    if (opp) move(opp, stage);
  };

  return (
    <>
      <PageHeader
        title="Pipeline de vendas"
        actions={
          <div className="flex gap-2">
            {can('pipeline.viewAll') && (
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-48">
                <option value="">Todos os comerciais</option>
                {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
            {can('pipeline.create') && <Button onClick={() => setEditing('new')}>Nova oportunidade</Button>}
          </div>
        }
      />
      <Tabs value={lineId} onChange={setLineId} tabs={active.map((l) => [l.id, l.name])} />
      <div className="mb-3"><Alert>{error || opps.error}</Alert></div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {stages.map((s) => {
          const items = opps.data?.filter((o) => o.stageId === s.id) ?? [];
          return (
            <div key={s.id} className="w-72 shrink-0 rounded-xl bg-slate-100 p-3" onDragOver={(e) => editable && e.preventDefault()} onDrop={onDrop(s)}>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <span className={`text-sm font-semibold ${s.isWon ? 'text-green-700' : s.isLost ? 'text-red-700' : ''}`}>{s.name}</span>
                <span className="text-xs text-slate-500">{items.length} · {formatKz(items.reduce((t, o) => t + o.value, 0))}</span>
              </div>
              <div className="space-y-2">
                {items.map((o) => (
                  <div
                    key={o.id}
                    draggable={editable}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)}
                    onClick={() => setEditing(o)}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm hover:border-brand-600"
                  >
                    <div className="font-medium">{o.title}</div>
                    <div className="text-slate-600">{o.client.name}</div>
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{formatKz(o.value)}</span>
                      <span>{o.expectedCloseAt ? formatDate(o.expectedCloseAt) : ''}</span>
                    </div>
                    {o.lostReason && <div className="mt-1 text-xs text-red-600">Motivo: {o.lostReason}</div>}
                    {o.owner && <div className="mt-1 text-xs text-slate-400">{o.owner.name}</div>}
                    {/* Alternativa ao arrastar (telemóvel / teclado) */}
                    {editable && (
                      <select
                        aria-label="Mover para"
                        className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-xs"
                        value={o.stageId}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => move(o, stages.find((x) => x.id === e.target.value)!)}
                      >
                        {stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {editing && line && (
        <OppForm opp={editing === 'new' ? null : editing} businessLineId={line.id} stages={stages} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); opps.reload(); }} />
      )}
      {losing && (
        <ConfirmModal title={`Marcar como "${losing.stage.name}"`} label="Motivo da perda (obrigatório)" required danger onClose={() => setLosing(null)}
          onConfirm={(reason) => move(losing.opp, losing.stage, reason)} />
      )}
    </>
  );
}

function OppForm({ opp, businessLineId, stages, onClose, onSaved }: { opp: Opp | null; businessLineId: string; stages: Stage[]; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const users = useUserOptions();
  const [client, setClient] = useState(opp?.client ?? null);
  const [f, setF] = useState({
    title: opp?.title ?? '',
    value: opp?.value ?? 0,
    stageId: opp?.stageId ?? stages.find((s) => !s.isLost)?.id ?? '',
    expectedCloseAt: toDateInput(opp?.expectedCloseAt),
    source: opp?.source ?? '',
    ownerId: opp?.ownerId ?? '',
    notes: opp?.notes ?? '',
  });
  const [error, setError] = useState('');
  const editable = opp ? can('pipeline.edit') : can('pipeline.create');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return setError('Seleccione o cliente');
    const body = { ...f, clientId: client.id, businessLineId, expectedCloseAt: f.expectedCloseAt || null, source: f.source || null, ownerId: f.ownerId || null };
    try {
      if (opp) await api(`/opportunities/${opp.id}`, { method: 'PATCH', body: { ...body, stageId: undefined } });
      else await api('/opportunities', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <Modal open title={opp ? 'Oportunidade' : 'Nova oportunidade'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Cliente"><ClientSelect value={client} onChange={setClient} disabled={!!opp} /></Field>
        <Field label="Título"><Input required disabled={!editable} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor previsto (Kz)"><Input type="number" min={0} step={1} disabled={!editable} value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></Field>
          <Field label="Data prevista de fecho"><Input type="date" disabled={!editable} value={f.expectedCloseAt} onChange={(e) => setF({ ...f, expectedCloseAt: e.target.value })} /></Field>
        </div>
        {!opp && (
          <Field label="Estado inicial">
            <Select value={f.stageId} onChange={(e) => setF({ ...f, stageId: e.target.value })}>
              {stages.filter((s) => !s.isLost).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origem">
            <Select disabled={!editable} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              <option value="">-</option>
              {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {can('pipeline.viewAll') && (
            <Field label="Comercial">
              <Select disabled={!editable} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
                <option value="">Eu</option>
                {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notas"><Textarea disabled={!editable} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {opp && <Link to={`/clientes/${opp.client.id}`}><Button type="button" variant="secondary">Ver cliente</Button></Link>}
            {opp && can('pipeline.create') && (
              <Link to={`/propostas/nova${toQuery({ clientId: opp.client.id, opportunityId: opp.id, businessLineId })}`}><Button type="button" variant="secondary">Criar proposta</Button></Link>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
            {editable && <Button type="submit">Guardar</Button>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
