import { formatDate, formatKz, OPERATION_STATUS, PHASE_STATUS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ClientSelect } from '../../components/ClientSelect';
import { ItemSelect, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatQty, toDateInput } from '../../lib/format';
import { useUserOptions, useWarehouses } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';
import { DocumentsPanel } from '../documents/DocumentsPage';

export type Kind = 'projects' | 'boreholes';
const META: Record<Kind, { title: string; one: string; route: string; entity: 'Project' | 'Borehole' }> = {
  projects: { title: 'Obras', one: 'Obra', route: '/obras', entity: 'Project' },
  boreholes: { title: 'Furos de água', one: 'Furo', route: '/furos', entity: 'Borehole' },
};
type Phase = { id: string; name: string; order: number; budget: number; status: keyof typeof PHASE_STATUS; progress: number; plannedStart: string | null; plannedEnd: string | null; notes: string | null };
type Op = {
  id: string; number: string; name: string; description: string | null; location: string | null; gps?: string | null; budget: number; status: keyof typeof OPERATION_STATUS;
  startDate: string | null; endDate: string | null; managerId: string | null; team: string[]; crew: string | null; result?: Record<string, string>;
  client: { id: string; name: string }; proposal: { id: string; number: string } | null; phases: Phase[]; progress?: number;
  costs: { materials: { id: string; date: string; code: string; name: string; unit: string; quantity: number; cost: number }[]; expenses: { id: string; date: string; category: string; description: string; amount: number }[]; materialCost: number; expenseCost: number; total: number };
  variance: number; variancePct: number | null;
};
const tone = (s: Op['status']) => (s === 'COMPLETED' ? 'green' : s === 'IN_PROGRESS' ? 'amber' : s === 'CANCELLED' || s === 'SUSPENDED' ? 'red' : 'slate');

export function OperationsList({ kind }: { kind: Kind }) {
  const m = META[kind];
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: '' });
  const list = useApi<Page<Op>>(`/operations/${kind}${toQuery({ page, ...f })}`);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title={m.title} actions={can('operations.create') && <Button onClick={() => setCreating(true)}>Nova {m.one.toLowerCase()}</Button>} />
      <p className="mb-4 text-sm text-slate-500">Também criadas automaticamente quando uma proposta da linha de negócio é aceite.</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Número, nome ou cliente…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}>
          <option value="">Todos os estados</option>
          {Object.entries(OPERATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', m.one, 'Cliente', 'Orçamento', 'Progresso', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`${m.route}/${o.id}`)}>
              <Td className="font-medium">{o.number}</Td><Td>{o.name}</Td><Td>{o.client.name}</Td><Td className="text-right">{formatKz(o.budget)}</Td>
              <Td className="w-40"><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${o.progress ?? 0}%` }} /></div><div className="text-xs text-slate-500">{o.progress ?? 0}%</div></Td>
              <Td><Badge tone={tone(o.status)}>{OPERATION_STATUS[o.status]}</Badge></Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {creating && <OpForm kind={kind} op={null} onClose={() => setCreating(false)} onSaved={(o) => navigate(`${m.route}/${o.id}`)} />}
    </>
  );
}

function OpForm({ kind, op, onClose, onSaved }: { kind: Kind; op: Op | null; onClose: () => void; onSaved: (o: Op) => void }) {
  const users = useUserOptions();
  const [client, setClient] = useState(op?.client ?? null);
  const [f, setF] = useState({
    name: op?.name ?? '', description: op?.description ?? '', location: op?.location ?? '', gps: op?.gps ?? '', budget: op?.budget ?? 0, status: op?.status ?? 'PLANNED',
    startDate: toDateInput(op?.startDate), endDate: toDateInput(op?.endDate), managerId: op?.managerId ?? '', team: op?.team ?? [], crew: op?.crew ?? '',
  });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return setError('Seleccione o cliente');
    const body = { ...f, clientId: client.id, startDate: f.startDate || null, endDate: f.endDate || null, ...(kind === 'projects' && { gps: undefined }) };
    try {
      onSaved(await api<Op>(op ? `/operations/${kind}/${op.id}` : `/operations/${kind}`, { method: op ? 'PATCH' : 'POST', body: op ? { ...body, clientId: undefined } : body }));
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={op ? `Editar ${op.number}` : `Nova ${META[kind].one.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Cliente"><ClientSelect value={client} onChange={setClient} disabled={!!op} /></Field>
        <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Local"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          {kind === 'boreholes' ? <Field label="GPS (lat,long)"><Input value={f.gps} onChange={(e) => setF({ ...f, gps: e.target.value })} placeholder="-8.83,13.23" /></Field> : <span />}
          <Field label="Orçamento (Kz)"><Input type="number" min={0} step={1} value={f.budget} onChange={(e) => setF({ ...f, budget: Number(e.target.value) })} /></Field>
          <Field label="Estado"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Op['status'] })}>{Object.entries(OPERATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Início"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Fim previsto"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Responsável"><Select value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}><option value="">-</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        </div>
        <Field label="Equipa (utilizadores)">
          <div className="flex flex-wrap gap-3">{users.data?.map((u) => <label key={u.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.team.includes(u.id)} onChange={(e) => setF({ ...f, team: e.target.checked ? [...f.team, u.id] : f.team.filter((x) => x !== u.id) })} /> {u.name}</label>)}</div>
        </Field>
        <Field label="Equipa externa / operários"><Input value={f.crew} onChange={(e) => setF({ ...f, crew: e.target.value })} /></Field>
        <Field label="Descrição"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export function OperationDetail({ kind }: { kind: Kind }) {
  const m = META[kind];
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const res = useApi<Op>(`/operations/${kind}/${id}`);
  const users = useUserOptions();
  const [editing, setEditing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [phase, setPhase] = useState<Phase | 'new' | null>(null);
  const o = res.data;
  if (res.error) return <Alert>{res.error}</Alert>;
  if (!o) return <div className="text-slate-500">A carregar…</div>;
  const names = new Map(users.data?.map((u) => [u.id, u.name]));
  const editable = can('operations.edit');
  const over = o.costs.total > o.budget && o.budget > 0;
  return (
    <>
      <PageHeader title={`${o.number} - ${o.name}`} actions={
        <div className="flex gap-2">
          {can('stock.edit') && !['COMPLETED', 'CANCELLED'].includes(o.status) && <Button variant="secondary" onClick={() => setIssuing(true)}>Consumir material</Button>}
          {editable && <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}
        </div>
      } />
      <Card className="mb-6 grid grid-cols-2 gap-4 p-5 text-sm lg:grid-cols-4">
        <div><div className="text-xs text-slate-500">Cliente</div><Link to={`/clientes/${o.client.id}`} className="text-brand-600 hover:underline">{o.client.name}</Link></div>
        <div><div className="text-xs text-slate-500">Estado</div><Badge tone={tone(o.status)}>{OPERATION_STATUS[o.status]}</Badge></div>
        <div><div className="text-xs text-slate-500">Período</div>{o.startDate ? formatDate(o.startDate) : '-'} → {o.endDate ? formatDate(o.endDate) : '-'}</div>
        <div><div className="text-xs text-slate-500">Local</div>{o.location ?? '-'}{o.gps && <a className="ml-2 text-brand-600 hover:underline" href={`https://maps.google.com/?q=${o.gps}`} target="_blank" rel="noreferrer">mapa</a>}</div>
        <div><div className="text-xs text-slate-500">Responsável</div>{o.managerId ? names.get(o.managerId) : '-'}</div>
        <div className="sm:col-span-2"><div className="text-xs text-slate-500">Equipa</div>{[...o.team.map((t) => names.get(t)), o.crew].filter(Boolean).join(', ') || '-'}</div>
        {o.proposal && <div><div className="text-xs text-slate-500">Proposta</div><Link to={`/propostas/${o.proposal.id}`} className="text-brand-600 hover:underline">{o.proposal.number}</Link></div>}
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {([['Orçamento', o.budget], ['Material', o.costs.materialCost], ['Despesas', o.costs.expenseCost], ['Custo real', o.costs.total]] as const).map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-xs text-slate-500">{l}</div><div className={`mt-1 text-lg font-semibold ${l === 'Custo real' && over ? 'text-red-700' : ''}`}>{formatKz(v)}</div></Card>
        ))}
        <Card className="p-4">
          <div className="text-xs text-slate-500">Orçado vs real</div>
          <div className={`mt-1 text-lg font-semibold ${over ? 'text-red-700' : 'text-green-700'}`}>{o.variancePct !== null ? `${o.variancePct}% usado` : '-'}</div>
          <div className="mt-2 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${over ? 'bg-red-600' : 'bg-brand-600'}`} style={{ width: `${Math.min(100, o.variancePct ?? 0)}%` }} /></div>
          <div className="mt-1 text-xs text-slate-500">{o.variance >= 0 ? `Disponível ${formatKz(o.variance)}` : `Excedido em ${formatKz(-o.variance)}`}</div>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="flex items-center justify-between px-4 pt-4"><h3 className="text-sm font-semibold">{kind === 'boreholes' ? 'Etapas de execução' : 'Fases'}</h3>{editable && <Button variant="secondary" onClick={() => setPhase('new')}>Adicionar</Button>}</div>
        <Table head={['#', 'Fase', 'Orçamento', 'Previsto', 'Progresso', 'Estado', '']} empty={o.phases.length === 0}>
          {o.phases.map((p) => (
            <tr key={p.id}>
              <Td>{p.order}</Td><Td className="font-medium">{p.name}{p.notes && <div className="text-xs text-slate-500">{p.notes}</div>}</Td>
              <Td className="text-right">{p.budget ? formatKz(p.budget) : '-'}</Td>
              <Td className="text-xs whitespace-nowrap">{p.plannedStart ? formatDate(p.plannedStart) : ''}{p.plannedEnd ? ` → ${formatDate(p.plannedEnd)}` : ''}</Td>
              <Td className="w-32"><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${p.progress}%` }} /></div><div className="text-xs text-slate-500">{p.progress}%</div></Td>
              <Td><Badge tone={p.status === 'DONE' ? 'green' : p.status === 'IN_PROGRESS' ? 'amber' : 'slate'}>{PHASE_STATUS[p.status]}</Badge></Td>
              <Td className="text-right">{editable && <button className="text-brand-600 hover:underline" onClick={() => setPhase(p)}>Editar</button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {kind === 'boreholes' && <BoreholeResult op={o} editable={editable} onSaved={res.reload} />}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="px-4 pt-4 text-sm font-semibold">Material consumido (stock)</h3>
          <Table head={['Data', 'Artigo', 'Qtd', 'Custo']} empty={o.costs.materials.length === 0}>
            {o.costs.materials.map((x) => <tr key={x.id}><Td>{formatDate(x.date)}</Td><Td><span className="font-mono text-xs">{x.code}</span> {x.name}</Td><Td className="text-right">{formatQty(x.quantity)} {x.unit}</Td><Td className="text-right">{formatKz(x.cost)}</Td></tr>)}
          </Table>
        </Card>
        <Card>
          <h3 className="px-4 pt-4 text-sm font-semibold">Despesas (centro de custo)</h3>
          <Table head={['Data', 'Categoria', 'Descrição', 'Valor']} empty={o.costs.expenses.length === 0}>
            {o.costs.expenses.map((x) => <tr key={x.id}><Td>{formatDate(x.date)}</Td><Td>{x.category}</Td><Td>{x.description}</Td><Td className="text-right">{formatKz(x.amount)}</Td></tr>)}
          </Table>
          <p className="px-4 pb-3 text-xs text-slate-500">Lance despesas em Financeiro → Receitas e despesas, com centro de custo "{m.one}" - ou aqui:</p>
          {can('finance.create') && <ExpenseForm entity={m.entity} entityId={o.id} onSaved={res.reload} />}
        </Card>
      </div>
      <h3 className="mb-2 text-sm font-semibold">Documentos (projectos, plantas, licenças)</h3>
      <DocumentsPanel entity={m.entity} entityId={o.id} />

      {editing && <OpForm kind={kind} op={o} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); res.reload(); }} />}
      {issuing && <IssueForm kind={kind} id={o.id} onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); res.reload(); }} />}
      {phase && <PhaseForm kind={kind} opId={o.id} phase={phase === 'new' ? null : phase} next={o.phases.length + 1} onClose={() => setPhase(null)} onSaved={() => { setPhase(null); res.reload(); }} />}
    </>
  );
}

function BoreholeResult({ op, editable, onSaved }: { op: Op; editable: boolean; onSaved: () => void }) {
  const preset = ['Profundidade', 'Caudal', 'Nível estático', 'Nível dinâmico', 'Diâmetro', 'Qualidade da água'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries([...preset, ...Object.keys(op.result ?? {})].map((k) => [k, op.result?.[k] ?? ''])));
  const [extra, setExtra] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <Card className="mb-6 p-4">
      <h3 className="mb-3 text-sm font-semibold">Resultado do furo</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.keys(vals).map((k) => <Field key={k} label={k}><Input disabled={!editable} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>)}
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input className="w-48" placeholder="Outro campo…" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <Button variant="secondary" disabled={!extra} onClick={() => { setVals({ ...vals, [extra]: '' }); setExtra(''); }}>Adicionar campo</Button>
          <Button onClick={async () => { await api(`/operations/boreholes/${op.id}`, { method: 'PATCH', body: { result: Object.fromEntries(Object.entries(vals).filter(([, v]) => v)) } }); setMsg('Guardado.'); onSaved(); }}>Guardar resultado</Button>
          <span className="text-xs text-green-700">{msg}</span>
        </div>
      )}
    </Card>
  );
}

function ExpenseForm({ entity, entityId, onSaved }: { entity: string; entityId: string; onSaved: () => void }) {
  const cats = useApi<{ id: string; name: string; type: string }[]>('/finance/categories');
  const [f, setF] = useState({ categoryId: '', amount: '', description: '', date: new Date().toLocaleDateString('en-CA') });
  const [error, setError] = useState('');
  return (
    <form className="grid items-end gap-2 px-4 pb-4 sm:grid-cols-5" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api('/finance/entries', { method: 'POST', body: { ...f, type: 'EXPENSE', entity, entityId } });
        setF({ ...f, amount: '', description: '' });
        setError('');
        onSaved();
      } catch (err) {
        setError(errMsg(err));
      }
    }}>
      <Select required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Categoria</option>{cats.data?.filter((c) => c.type === 'EXPENSE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      <Input required placeholder="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <Input type="number" min={1} required placeholder="Kz" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <Button type="submit">Lançar</Button>
      {error && <div className="text-xs text-red-600 sm:col-span-5">{error}</div>}
    </form>
  );
}

function IssueForm({ kind, id, onClose, onDone }: { kind: Kind; id: string; onClose: () => void; onDone: () => void }) {
  const whs = useWarehouses();
  const [wh, setWh] = useState('');
  const [lines, setLines] = useState<{ item: Opt | null; quantity: string }[]>([{ item: null, quantity: '' }]);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (lines.some((l) => !l.item)) return setError('Seleccione os artigos');
    try {
      await api(`/operations/${kind}/${id}/materials`, { method: 'POST', body: { warehouseId: wh || whs.data?.[0]?.id, lines: lines.map((l) => ({ itemId: l.item!.id, quantity: Number(l.quantity) })) } });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title="Consumir material do stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{error}</Alert>
        <Field label="Armazém"><Select value={wh || whs.data?.[0]?.id} onChange={(e) => setWh(e.target.value)}>{whs.data?.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px] gap-2">
            <ItemSelect value={l.item} onChange={(o) => setLines(lines.map((x, j) => (j === i ? { ...x, item: o } : x)))} />
            <Input type="number" min={0.001} step="any" required placeholder={l.item?.hint ?? 'Qtd'} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setLines([...lines, { item: null, quantity: '' }])}>+ Artigo</Button>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Registar saída</Button></div>
      </form>
    </Modal>
  );
}

function PhaseForm({ kind, opId, phase, next, onClose, onSaved }: { kind: Kind; opId: string; phase: Phase | null; next: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: phase?.name ?? '', order: phase?.order ?? next, budget: phase?.budget ?? 0, status: phase?.status ?? 'PENDING', progress: phase?.progress ?? 0, plannedStart: toDateInput(phase?.plannedStart), plannedEnd: toDateInput(phase?.plannedEnd), notes: phase?.notes ?? '' });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/operations/${kind}/${opId}/phases${phase ? `/${phase.id}` : ''}`, { method: phase ? 'PATCH' : 'POST', body: { ...f, plannedStart: f.plannedStart || null, plannedEnd: f.plannedEnd || null } });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={phase ? 'Editar fase' : 'Nova fase'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-[80px_1fr]">
          <Field label="Ordem"><Input type="number" value={f.order} onChange={(e) => setF({ ...f, order: Number(e.target.value) })} /></Field>
          <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Orçamento (Kz)"><Input type="number" min={0} value={f.budget} onChange={(e) => setF({ ...f, budget: Number(e.target.value) })} /></Field>
          <Field label="Estado"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Phase['status'] })}>{Object.entries(PHASE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Progresso (%)"><Input type="number" min={0} max={100} value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} /></Field>
          <Field label="Início previsto"><Input type="date" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} /></Field>
          <Field label="Fim previsto"><Input type="date" value={f.plannedEnd} onChange={(e) => setF({ ...f, plannedEnd: e.target.value })} /></Field>
        </div>
        <Field label="Notas"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

