import { formatDateTime } from '@ivamarg/shared';
import { Fragment, useState } from 'react';
import { Alert, Card, Field, Input, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { toQuery } from '../../lib/api';
import { useApi, type Page } from '../../lib/useApi';

type Log = {
  id: string;
  entity: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
};

// Datas do filtro são dias em Luanda (UTC+1, sem horário de verão).
const dayStart = (d: string) => (d ? `${d}T00:00:00+01:00` : undefined);
const dayEnd = (d: string) => (d ? `${d}T23:59:59.999+01:00` : undefined);

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ entity: '', search: '', from: '', to: '' });
  const logs = useApi<Page<Log>>(`/audit${toQuery({ page, entity: f.entity, search: f.search, from: dayStart(f.from), to: dayEnd(f.to) })}`);
  const entities = useApi<string[]>('/audit/entities');
  const [open, setOpen] = useState<string>();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title="Auditoria" />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Entidade">
          <Select value={f.entity} onChange={set('entity')}>
            <option value="">Todas</option>
            {entities.data?.map((e) => <option key={e}>{e}</option>)}
          </Select>
        </Field>
        <Field label="Acção"><Input placeholder="ex.: login, update" value={f.search} onChange={set('search')} /></Field>
        <Field label="De"><Input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="Até"><Input type="date" value={f.to} onChange={set('to')} /></Field>
      </div>
      <Alert>{logs.error}</Alert>
      <Card>
        <Table head={['Data/hora', 'Utilizador', 'Entidade', 'Acção', 'IP', '']} empty={logs.data?.items.length === 0}>
          {logs.data?.items.map((l) => (
            <Fragment key={l.id}>
              <tr>
                <Td className="whitespace-nowrap">{formatDateTime(l.createdAt)}</Td>
                <Td>{l.user?.name ?? '-'}</Td>
                <Td>{l.entity}{l.entityId && <span className="ml-1 text-xs text-slate-400">{l.entityId.slice(-6)}</span>}</Td>
                <Td className="font-mono text-xs">{l.action}</Td>
                <Td className="text-slate-500">{l.ip ?? '-'}</Td>
                <Td className="text-right">
                  {(l.before != null || l.after != null) && (
                    <button className="text-brand-600 hover:underline" onClick={() => setOpen(open === l.id ? undefined : l.id)}>
                      {open === l.id ? 'Fechar' : 'Detalhe'}
                    </button>
                  )}
                </Td>
              </tr>
              {open === l.id && (
                <tr>
                  <td colSpan={6} className="bg-slate-50 px-4 py-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      {(['before', 'after'] as const).map((k) => (
                        <div key={k}>
                          <div className="mb-1 text-xs font-medium text-slate-500">{k === 'before' ? 'Antes' : 'Depois'}</div>
                          <pre className="overflow-x-auto rounded bg-white p-3 text-xs">{l[k] == null ? '-' : JSON.stringify(l[k], null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
        {logs.data && <Pagination {...logs.data} onPage={setPage} />}
      </Card>
    </>
  );
}
