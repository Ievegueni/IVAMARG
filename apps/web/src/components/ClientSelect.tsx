import { SearchSelect } from './SearchSelect';

type Client = { id: string; name: string; nif?: string | null };

/** Pesquisa de cliente (respeita a carteira do utilizador). */
export const ClientSelect = ({ value, onChange, disabled }: { value: Client | null; onChange: (c: Client | null) => void; disabled?: boolean }) => (
  <SearchSelect<Client>
    path="/clients"
    map={(c) => ({ id: c.id, label: c.name, hint: c.nif ? `NIF ${c.nif}` : null })}
    value={value && { id: value.id, label: value.name, hint: value.nif ? `NIF ${value.nif}` : null }}
    onChange={(o) => onChange(o && o.raw)}
    disabled={disabled}
    placeholder="Pesquisar cliente por nome, NIF, telefone…"
  />
);
