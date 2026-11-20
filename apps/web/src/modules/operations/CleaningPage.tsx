import { formatDateTime, TIMEZONE, VISIT_STATUS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useApi } from '../../lib/useApi';

type Contract = { id: string; number: string; title: string; client: { id: string; name: string }; visitDays: number[]; visitTime: string | null; visitTeam: string | null; _count: { visits: number } };
type Visit = { id: string; scheduledAt: string; team: string | null; status: keyof typeof VISIT_STATUS; notes: string | null; executedAt: string | null; checklist: { item: string; done: boolean }[]; contract: { id: string; number: string; title: string; client: { id: string; name: string } } };
const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const dayKey = (d: string | Date) => new Intl.DateTimeFormat('pt-PT', { timeZone: TIMEZONE, weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(d));

export function CleaningPage() {
  const { can } = useAuth();
  const contracts = useApi<Contract[]>('/operations/cleaning-contracts');
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; });
  const to = new Date(weekStart.getTime() + 7 * 86400000);
  const visits = useApi<Visit[]>(`/operations/visits${toQuery({ from: weekStart.toISOString(), to: to.toISOString() })}`);
  const [planning, setPlanning] = useState<Contract | null>(null);
  const [open, setOpen] = useState<Visit | null>(null);
  const grouped = new Map<string, Visit[]>();
  for (const v of visits.data ?? []) grouped.set(dayKey(v.scheduledAt), [...(grouped.get(dayKey(v.scheduledAt)) ?? []), v]);

  return (
    <>
      <PageHeader title="Limpeza e jardinagem" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}>← Semana anterior</Button>
            <Button variant="secondary" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}>Semana seguinte →</Button>
          </div>
          <Alert>{visits.error}</Alert>
          {visits.data?.length === 0 && <Card className="p-6 text-sm text-slate-500">Sem visitas nesta semana.</Card>}
          <div className="space-y-4">
            {[...grouped.entries()].map(([day, vs]) => (
              <Card key={day}>
                <h3 className="px-4 pt-3 text-sm font-semibold capitalize">{day}</h3>
                <ul className="divide-y divide-slate-100">
                  {vs.map((v) => (
                    <li key={v.id}>
                      <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setOpen(v)}>
                        <span><b>{formatDateTime(v.scheduledAt).split(' ')[1]}</b> · {v.contract.client.name} <span className="text-slate-500">({v.contract.title}{v.team && ` · ${v.team}`})</span></span>
                        <Badge tone={v.status === 'DONE' ? 'green' : v.status === 'MISSED' ? 'red' : 'slate'}>{VISIT_STATUS[v.status]}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
        <Card>
          <h3 className="px-4 pt-4 text-sm font-semibold">Contratos recorrentes activos</h3>
          <Table head={['Contrato', 'Plano', '']} empty={contracts.data?.length === 0}>
            {contracts.data?.map((c) => (
              <tr key={c.id}>
                <Td><Link to={`/clientes/${c.client.id}`} className="font-medium text-brand-600 hover:underline">{c.client.name}</Link><div className="text-xs text-slate-500">{c.number} · {c.title}</div></Td>
                <Td className="text-xs">{c.visitDays.length ? `${c.visitDays.map((d) => DAYS[d - 1]).join(', ')} ${c.visitTime}` : '-'}</Td>
                <Td className="text-right">{can('operations.edit') && <button className="text-brand-600 hover:underline" onClick={() => setPlanning(c)}>Planear</button>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      {planning && <PlanForm c={planning} onClose={() => setPlanning(null)} onDone={() => { setPlanning(null); contracts.reload(); visits.reload(); }} />}
      {open && <VisitForm v={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); visits.reload(); }} />}
    </>
  );
}

function PlanForm({ c, onClose, onDone }: { c: Contract; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ visitDays: c.visitDays.length ? c.visitDays : [1, 3, 5], visitTime: c.visitTime ?? '08:00', visitTeam: c.visitTeam ?? '', weeks: 4 });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/operations/contracts/${c.id}/plan-visits`, { method: 'POST', body: f });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={`Planear visitas - ${c.client.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Dias da semana">
          <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.visitDays.includes(i + 1)} onChange={(e) => setF({ ...f, visitDays: e.target.checked ? [...f.visitDays, i + 1] : f.visitDays.filter((x) => x !== i + 1) })} /> {d}</label>)}</div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Hora"><Input type="time" value={f.visitTime} onChange={(e) => setF({ ...f, visitTime: e.target.value })} /></Field>
          <Field label="Semanas a gerar"><Input type="number" min={1} max={26} value={f.weeks} onChange={(e) => setF({ ...f, weeks: Number(e.target.value) })} /></Field>
          <Field label="Equipa"><Input value={f.visitTeam} onChange={(e) => setF({ ...f, visitTeam: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500">Visitas já existentes não são duplicadas.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Gerar visitas</Button></div>
      </form>
    </Modal>
  );
}

function VisitForm({ v, onClose, onSaved }: { v: Visit; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const [f, setF] = useState({ status: v.status, notes: v.notes ?? '', team: v.team ?? '', checklist: v.checklist });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/operations/visits/${v.id}`, { method: 'PATCH', body: f });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={`Visita - ${v.contract.client.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-sm text-slate-600">{formatDateTime(v.scheduledAt)} · {v.contract.title}{v.executedAt && ` · registada ${formatDateTime(v.executedAt)}`}</p>
        <Field label="Checklist">
          <div className="space-y-1">{f.checklist.map((c, i) => <label key={c.item} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.done} onChange={(e) => setF({ ...f, checklist: f.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} /> {c.item}</label>)}</div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estado"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Visit['status'] })}>{Object.entries(VISIT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Equipa"><Input value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /></Field>
        </div>
        <Field label="Notas / ocorrências"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>{can('operations.edit') && <Button type="submit">Guardar</Button>}</div>
      </form>
    </Modal>
  );
}
