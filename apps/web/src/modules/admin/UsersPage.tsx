import { formatDateTime } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { useAuth, type User } from '../../app/auth';
import { PermissionGrid } from '../../components/PermissionGrid';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { useApi, type Page } from '../../lib/useApi';

type Role = { id: string; name: string; isAdmin: boolean; permissions: string[] };

export function UsersPage() {
  const { can, user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const users = useApi<Page<User>>(`/users${toQuery({ page, search })}`);
  const roles = useApi<Role[]>('/roles');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [error, setError] = useState('');

  const toggleActive = async (u: User) => {
    setError('');
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
      users.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Utilizadores" actions={can('admin.create') && <Button onClick={() => setEditing('new')}>Novo utilizador</Button>} />
      <div className="mb-4 space-y-3">
        <Alert>{error || users.error}</Alert>
        <Input placeholder="Pesquisar por nome, utilizador ou email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
      </div>
      <Card>
        <Table head={['Nome', 'Utilizador', 'Email', 'Perfil', 'Estado', 'Último acesso', '']} empty={users.data?.items.length === 0}>
          {users.data?.items.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium">{u.name}</Td>
              <Td className="font-mono text-sm">{u.username}</Td>
              <Td>{u.email}</Td>
              <Td>{u.role.name}</Td>
              <Td>{u.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
              <Td className="whitespace-nowrap text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '-'}</Td>
              <Td className="space-x-3 text-right whitespace-nowrap">
                {can('admin.edit') && (
                  <>
                    <button className="text-brand-600 hover:underline" onClick={() => setEditing(u)}>Editar</button>
                    {u.id !== me?.id && (
                      <button className="text-slate-600 hover:underline" onClick={() => toggleActive(u)}>
                        {u.active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {users.data && <Pagination {...users.data} onPage={setPage} />}
      </Card>
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          roles={roles.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); users.reload(); }}
        />
      )}
    </>
  );
}

function UserForm({ user, roles, onClose, onSaved }: { user: User | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user?.name ?? '', username: user?.username ?? '', email: user?.email ?? '', roleId: user?.role.id ?? '', password: '', phone: (user as User & { phone?: string | null })?.phone ?? '' });
  const [extra, setExtra] = useState<string[]>((user as User & { extraPermissions?: string[] })?.extraPermissions ?? []);
  const [showExtra, setShowExtra] = useState(extra.length > 0);
  const { user: me } = useAuth();
  const role = roles.find((r) => r.id === form.roleId);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...form, password: form.password || undefined, ...(user?.id !== me?.id && { extraPermissions: extra }) };
      if (user) await api(`/users/${user.id}`, { method: 'PATCH', body });
      else await api('/users', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal open wide={showExtra} title={user ? 'Editar utilizador' : 'Novo utilizador'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Nome"><Input required value={form.name} onChange={set('name')} /></Field>
        <Field label="Nome de utilizador (para entrar)"><Input required autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9._\-]+" title="Só letras, números, ponto, hífen e sublinhado" placeholder="ex.: joao.silva" value={form.username} onChange={set('username')} /></Field>
        <Field label="Email"><Input type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Telemóvel (alertas WhatsApp/SMS)"><Input value={form.phone} onChange={set('phone')} placeholder="923 456 789" /></Field>
        <Field label="Perfil">
          <Select required value={form.roleId} onChange={set('roleId')}>
            <option value="">- Seleccionar -</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label={user ? 'Nova palavra-passe (deixar vazio para manter)' : 'Palavra-passe (mín. 8 caracteres)'}>
          <Input type="password" minLength={8} required={!user} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        {role && !role.isAdmin && user?.id !== me?.id && (
          <div className="rounded-lg border border-slate-200">
            <button type="button" onClick={() => setShowExtra(!showExtra)} className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium text-slate-700">
              Permissões adicionais a este utilizador {extra.length > 0 && <span className="text-xs text-brand-600">{extra.length} concedida(s)</span>}
            </button>
            {showExtra && (
              <div className="border-t border-slate-200 p-3">
                <p className="mb-2 text-xs text-slate-500">As marcadas a cinzento vêm do perfil "{role.name}". Marque só o que este utilizador precisa a mais.</p>
                <PermissionGrid value={extra} onChange={setExtra} locked={role.permissions} />
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
