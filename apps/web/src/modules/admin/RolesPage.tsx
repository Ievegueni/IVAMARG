import { ALL_PERMISSIONS } from '@ivamarg/shared';
import { PermissionGrid } from '../../components/PermissionGrid';
import { useEffect, useState } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Card, Input, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';

type Role = { id: string; name: string; isAdmin: boolean; permissions: string[]; _count: { users: number } };

export function RolesPage() {
  const { can } = useAuth();
  const roles = useApi<Role[]>('/roles');
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<{ name: string; permissions: string[] }>();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const selected = roles.data?.find((r) => r.id === selectedId);
  const editable = can('admin.edit') && !selected?.isAdmin;

  useEffect(() => {
    if (!selectedId && roles.data?.length) setSelectedId(roles.data[0].id);
  }, [roles.data, selectedId]);
  useEffect(() => {
    if (selected) setDraft({ name: selected.name, permissions: selected.permissions });
  }, [selected]);


  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(undefined);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await roles.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  const create = () => {
    const name = prompt('Nome do novo perfil');
    if (name) run(async () => setSelectedId((await api<Role>('/roles', { method: 'POST', body: { name, permissions: [] } })).id), 'Perfil criado.');
  };

  return (
    <>
      <PageHeader title="Perfis e permissões" actions={can('admin.create') && <Button onClick={create}>Novo perfil</Button>} />
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text ?? roles.error}</Alert></div>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card className="p-2">
          {roles.data?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm ${r.id === selectedId ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-slate-50'}`}
            >
              {r.name}
              <span className="text-xs text-slate-400">{r._count.users}</span>
            </button>
          ))}
        </Card>
        {selected && draft && (
          <Card className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Input value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="max-w-xs" />
              {selected.isAdmin && <span className="text-sm text-slate-500">O Administrador tem acesso total.</span>}
            </div>
            <PermissionGrid value={selected.isAdmin ? ALL_PERMISSIONS : draft.permissions} onChange={(permissions) => setDraft({ ...draft, permissions })} disabled={!editable} />
            {editable && (
              <div className="mt-6 flex justify-between gap-2">
                {can('admin.delete') && (
                  <Button variant="danger" onClick={() => confirm(`Eliminar o perfil "${selected.name}"?`) && run(async () => { await api(`/roles/${selected.id}`, { method: 'DELETE' }); setSelectedId(undefined); }, 'Perfil eliminado.')}>
                    Eliminar
                  </Button>
                )}
                <Button onClick={() => run(() => api(`/roles/${selected.id}`, { method: 'PATCH', body: draft }), 'Permissões guardadas.')}>Guardar</Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
