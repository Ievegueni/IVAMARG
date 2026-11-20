import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Input, PageHeader, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useApi } from '../../lib/useApi';

type Cat = { id: string; name: string; roleIds: string[]; active: boolean };

/** Categorias de documentos e quem as pode ver (vazio = todos com acesso a documentos). */
export function DocumentSettingsPage() {
  const { can } = useAuth();
  const cats = useApi<Cat[]>('/documents/categories');
  const roles = useApi<{ id: string; name: string; isAdmin: boolean }[]>(can('admin.view') ? '/roles' : null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const editable = can('backoffice.edit');
  const save = async (path: string, method: 'POST' | 'PATCH', body: object) => {
    setError('');
    try {
      await api(path, { method, body });
      cats.reload();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const toggleRole = (c: Cat, roleId: string) => save(`/documents/categories/${c.id}`, 'PATCH', { roleIds: c.roleIds.includes(roleId) ? c.roleIds.filter((r) => r !== roleId) : [...c.roleIds, roleId] });
  return (
    <>
      <PageHeader title="Categorias de documentos" />
      <Alert>{error}</Alert>
      {editable && (
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); save('/documents/categories', 'POST', { name }).then(() => setName('')); }}>
          <Input required placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      <Card>
        <Table head={['Categoria', 'Visível para', 'Estado', '']}>
          {cats.data?.map((c) => (
            <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
              <Td className="font-medium">{c.name}</Td>
              <Td>
                {roles.data ? (
                  <div className="flex flex-wrap gap-3">
                    {roles.data.filter((r) => !r.isAdmin).map((r) => (
                      <label key={r.id} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" disabled={!editable} checked={c.roleIds.includes(r.id)} onChange={() => toggleRole(c, r.id)} /> {r.name}
                      </label>
                    ))}
                    {!c.roleIds.length && <span className="text-xs text-slate-500">(nenhum marcado = todos)</span>}
                  </div>
                ) : c.roleIds.length ? 'Restrita' : 'Todos'}
              </Td>
              <Td>{c.active ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
              <Td className="text-right">{editable && <button className="text-brand-600 hover:underline" onClick={() => save(`/documents/categories/${c.id}`, 'PATCH', { active: !c.active })}>{c.active ? 'Desactivar' : 'Activar'}</button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Administradores vêem sempre todas as categorias.</p>
    </>
  );
}
