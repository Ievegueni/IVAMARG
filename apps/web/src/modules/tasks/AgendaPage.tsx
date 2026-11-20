import { EVENT_TYPES, TIMEZONE } from '@ivamarg/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useUserOptions } from '../../lib/options';
import { useApi } from '../../lib/useApi';

type Ev = { id: string; title: string; description: string | null; type: keyof typeof EVENT_TYPES; startAt: string; endAt: string; location: string | null; attendeeIds: string[]; createdById: string | null };

const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
const time = (iso: string) => new Intl.DateTimeFormat('pt-PT', { timeZone: TIMEZONE, timeStyle: 'short' }).format(new Date(iso));
const dayLabel = (d: Date) => new Intl.DateTimeFormat('pt-PT', { timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Agenda semanal (segunda a domingo). */
export function AgendaPage() {
  const { can } = useAuth();
  const users = useUserOptions();
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  });
  const [userId, setUserId] = useState('');
  const end = new Date(weekStart.getTime() + 7 * 86400000);
  const events = useApi<Ev[]>(`/tasks/events${toQuery({ from: weekStart.toISOString(), to: end.toISOString(), userId })}`);
  const [editing, setEditing] = useState<Ev | 'new' | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000 + 12 * 3600_000)), [weekStart]);
  const names = new Map(users.data?.map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader title="Agenda" actions={can('tasks.create') && <Button onClick={() => setEditing('new')}>Novo evento</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}>← Semana anterior</Button>
        <Button variant="secondary" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}>Semana seguinte →</Button>
        {can('tasks.viewAll') && (
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-56">
            <option value="">Todos</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
      </div>
      <Alert>{events.error}</Alert>
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => {
          const mine = events.data?.filter((e) => dayKey(new Date(e.startAt)) === dayKey(d)) ?? [];
          const today = dayKey(d) === dayKey(new Date());
          return (
            <Card key={d.toISOString()} className={`min-h-28 p-2 ${today ? 'ring-2 ring-brand-600' : ''}`}>
              <div className="mb-2 text-xs font-semibold text-slate-600 capitalize">{dayLabel(d)}</div>
              <div className="space-y-1.5">
                {mine.map((e) => (
                  <button key={e.id} onClick={() => setEditing(e)} className="w-full rounded-md bg-brand-50 p-1.5 text-left text-xs hover:bg-brand-100">
                    <div className="font-medium text-brand-900">{time(e.startAt)} {e.title}</div>
                    <div className="text-slate-500">{EVENT_TYPES[e.type]}{e.location && ` · ${e.location}`}</div>
                    {e.attendeeIds.length > 1 && <div className="text-slate-400">{e.attendeeIds.map((a) => names.get(a)).filter(Boolean).join(', ')}</div>}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {editing && <EventForm ev={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); events.reload(); }} />}
    </>
  );
}

function EventForm({ ev, onClose, onSaved }: { ev: Ev | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const users = useUserOptions();
  const start = ev ? new Date(ev.startAt) : new Date(Math.ceil(Date.now() / 3600_000) * 3600_000);
  const [f, setF] = useState({
    title: ev?.title ?? '', type: ev?.type ?? 'MEETING', startAt: local(start), endAt: local(ev ? new Date(ev.endAt) : new Date(start.getTime() + 3600_000)),
    location: ev?.location ?? '', description: ev?.description ?? '', attendeeIds: ev?.attendeeIds ?? [],
  });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, startAt: new Date(f.startAt).toISOString(), endAt: new Date(f.endAt).toISOString() };
    try {
      await api(ev ? `/tasks/events/${ev.id}` : '/tasks/events', { method: ev ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={ev ? 'Evento' : 'Novo evento'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Título"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Ev['type'] })}>
              {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Local"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Início"><Input type="datetime-local" required value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} /></Field>
          <Field label="Fim"><Input type="datetime-local" required value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} /></Field>
        </div>
        <Field label="Participantes">
          <div className="flex flex-wrap gap-2">
            {users.data?.filter((u) => u.id !== user?.id).map((u) => (
              <label key={u.id} className="flex items-center gap-1 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.attendeeIds.includes(u.id)}
                  onChange={(e) => setF({ ...f, attendeeIds: e.target.checked ? [...f.attendeeIds, u.id] : f.attendeeIds.filter((x) => x !== u.id) })} />
                {u.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Notas"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          {ev && <Button type="button" variant="danger" className="mr-auto" onClick={async () => { await api(`/tasks/events/${ev.id}`, { method: 'DELETE' }).catch((e) => setError(errMsg(e))); onSaved(); }}>Eliminar</Button>}
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
