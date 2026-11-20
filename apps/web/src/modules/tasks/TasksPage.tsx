import { formatDateTime, LINKABLE_ENTITIES, PRIORITY, TASK_STATUS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useUserOptions } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';

export type Task = {
  id: string; title: string; description: string | null; dueAt: string | null; priority: keyof typeof PRIORITY; status: keyof typeof TASK_STATUS;
  assigneeId: string; assignee: { id: string; name: string }; entity: keyof typeof LINKABLE_ENTITIES | null; entityId: string | null;
};
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function TasksPage() {
  const { can, user } = useAuth();
  const users = useUserOptions();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ status: 'OPEN', assigneeId: '', search: '', overdue: '' });
  const list = useApi<Page<Task>>(`/tasks${toQuery({ page, ...f, overdue: f.overdue ? 'true' : undefined })}`);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const toggleDone = async (t: Task) => {
    await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'DONE' ? 'TODO' : 'DONE' } }).catch(() => {});
    list.reload();
  };

  return (
    <>
      <PageHeader title="Tarefas" actions={can('tasks.create') && <Button onClick={() => setEditing('new')}>Nova tarefa</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Input placeholder="Pesquisar…" value={f.search} onChange={set('search')} />
        <Select value={f.status} onChange={set('status')}>
          <option value="OPEN">Abertas</option>
          <option value="">Todas</option>
          {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {can('tasks.viewAll') ? (
          <Select value={f.assigneeId} onChange={set('assigneeId')}>
            <option value="">Todos os responsáveis</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        ) : <span />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked ? '1' : '' })} /> Só em atraso</label>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['', 'Tarefa', 'Responsável', 'Prazo', 'Prioridade', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((t) => {
            const late = t.dueAt && new Date(t.dueAt) < new Date() && ['TODO', 'IN_PROGRESS'].includes(t.status);
            return (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td className="w-8"><input type="checkbox" aria-label="Concluída" className="h-4 w-4 accent-brand-600" checked={t.status === 'DONE'} onChange={() => toggleDone(t)} /></Td>
                <Td><button className={`text-left font-medium hover:underline ${t.status === 'DONE' ? 'text-slate-400 line-through' : ''}`} onClick={() => setEditing(t)}>{t.title}</button>{t.entity && <div className="text-xs text-slate-500">{LINKABLE_ENTITIES[t.entity]}</div>}</Td>
                <Td>{t.assignee.id === user?.id ? 'Eu' : t.assignee.name}</Td>
                <Td className="whitespace-nowrap">{t.dueAt ? (late ? <Badge tone="red">{formatDateTime(t.dueAt)}</Badge> : formatDateTime(t.dueAt)) : '-'}</Td>
                <Td>{t.priority === 'URGENT' || t.priority === 'HIGH' ? <Badge tone="amber">{PRIORITY[t.priority]}</Badge> : PRIORITY[t.priority]}</Td>
                <Td>{TASK_STATUS[t.status]}</Td>
              </tr>
            );
          })}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {editing && <TaskForm task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function TaskForm({ task, onClose, onSaved }: { task: Task | null; onClose: () => void; onSaved: () => void }) {
  const { user, can } = useAuth();
  const users = useUserOptions();
  const [f, setF] = useState({
    title: task?.title ?? '', description: task?.description ?? '', assigneeId: task?.assigneeId ?? user?.id ?? '', dueAt: toLocalInput(task?.dueAt ?? null),
    priority: task?.priority ?? 'NORMAL', status: task?.status ?? 'TODO',
  });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null };
    try {
      await api(task ? `/tasks/${task.id}` : '/tasks', { method: task ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={task ? 'Tarefa' : 'Nova tarefa'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Título"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsável">
            <Select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Prazo"><Input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
          <Field label="Prioridade">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task['priority'] })}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Task['status'] })}>
              {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Descrição"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          {task && can('tasks.delete') && <Button type="button" variant="danger" className="mr-auto" onClick={async () => { await api(`/tasks/${task.id}`, { method: 'DELETE' }).catch((e) => setError(errMsg(e))); onSaved(); }}>Eliminar</Button>}
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
