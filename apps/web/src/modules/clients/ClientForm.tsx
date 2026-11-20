import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { api, ApiError, toQuery } from '../../lib/api';
import { errMsg, formatPhone } from '../../lib/format';
import { useBusinessLines, useUserOptions } from '../../lib/options';

export type Client = {
  id: string;
  name: string;
  nif: string | null;
  phones: string[];
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  businessLines: { id: string; name: string }[];
};
type Dup = { id: string; name: string; matches: string[] };

const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function ClientForm({ client, onClose, onSaved }: { client: Client | null; onClose: () => void; onSaved: (c: Client) => void }) {
  const { can } = useAuth();
  const lines = useBusinessLines();
  const users = useUserOptions();
  const [f, setF] = useState({
    name: client?.name ?? '',
    nif: client?.nif ?? '',
    phones: client?.phones.map(formatPhone).join(', ') ?? '',
    email: client?.email ?? '',
    address: client?.address ?? '',
    notes: client?.notes ?? '',
    tags: client?.tags.join(', ') ?? '',
    ownerId: client?.ownerId ?? '',
    businessLineIds: client?.businessLines.map((b) => b.id) ?? [],
  });
  const [dups, setDups] = useState<Dup[]>([]);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  // Aviso de duplicados enquanto se preenche (NIF bloqueia no servidor; telefone/email só avisam).
  useEffect(() => {
    if (!f.nif && !f.phones && !f.email) return setDups([]);
    const t = setTimeout(() => {
      api<Dup[]>(`/clients/check-duplicates${toQuery({ nif: f.nif, phone: split(f.phones).join(','), email: f.email, excludeId: client?.id })}`)
        .then(setDups)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [f.nif, f.phones, f.email, client?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body = { ...f, phones: split(f.phones), tags: split(f.tags), ownerId: f.ownerId || null };
    try {
      onSaved(client ? await api<Client>(`/clients/${client.id}`, { method: 'PATCH', body }) : await api<Client>('/clients', { method: 'POST', body }));
    } catch (err) {
      setError(err instanceof ApiError && err.details ? err.details.map((d) => d.message).join(' · ') : errMsg(err));
    }
  };

  return (
    <Modal open title={client ? 'Editar cliente' : 'Novo cliente'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {dups.length > 0 && (
          <Alert tone="info">
            Possível duplicado:{' '}
            {dups.map((d) => <span key={d.id} className="mr-2"><a href={`/clientes/${d.id}`} target="_blank" className="underline">{d.name}</a> ({d.matches.join(', ')})</span>)}
          </Alert>
        )}
        <Field label="Nome / empresa"><Input required value={f.name} onChange={set('name')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NIF"><Input value={f.nif} onChange={set('nif')} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Telefone(s) - separar por vírgula"><Input value={f.phones} onChange={set('phones')} placeholder="923 456 789, 222 123 456" /></Field>
        <Field label="Morada"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Linhas de negócio">
          <div className="flex flex-wrap gap-3">
            {lines.data?.filter((l) => l.active).map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={f.businessLineIds.includes(l.id)}
                  onChange={(e) => setF({ ...f, businessLineIds: e.target.checked ? [...f.businessLineIds, l.id] : f.businessLineIds.filter((x) => x !== l.id) })}
                />
                {l.name}
              </label>
            ))}
          </div>
        </Field>
        {can('clients.viewAll') && (
          <Field label="Comercial responsável">
            <Select value={f.ownerId} onChange={set('ownerId')}>
              <option value="">- Nenhum -</option>
              {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Tags - separar por vírgula"><Input value={f.tags} onChange={set('tags')} placeholder="escola, governo" /></Field>
        <Field label="Notas"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
