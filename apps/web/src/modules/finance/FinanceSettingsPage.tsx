import { COMMISSION_BASE, COMMISSION_TYPE, formatKz } from '@ivamarg/shared';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { ModelSelect, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Tabs, Td } from '../../components/ui';
import { useBusinessLines, useUserOptions } from '../../lib/options';
import { useAction, useApi } from '../../lib/useApi';

type Rule = { id: string; name: string; type: keyof typeof COMMISSION_TYPE; value: string; base: keyof typeof COMMISSION_BASE; userId: string | null; businessLineId: string | null; productModelId: string | null; active: boolean };
type Kpi = { key: string; name: string; unit: string; active: boolean; targets: { userId: string | null; value: string }[] };

export function FinanceSettingsPage() {
  const [tab, setTab] = useState<'rules' | 'kpis' | 'cats'>('rules');
  return (
    <>
      <PageHeader title="Comissões, KPIs e categorias" />
      <Tabs value={tab} onChange={setTab} tabs={[['rules', 'Regras de comissão'], ['kpis', 'KPIs e metas'], ['cats', 'Categorias financeiras']]} />
      {tab === 'rules' && <Rules />}
      {tab === 'kpis' && <Kpis />}
      {tab === 'cats' && <Cats />}
    </>
  );
}

function Rules() {
  const { can } = useAuth();
  const rules = useApi<Rule[]>('/finance/commission-rules');
  const users = useUserOptions();
  const lines = useBusinessLines();
  const { error, act } = useAction(rules.reload);
  const [f, setF] = useState({ name: '', type: 'PERCENT', value: '', base: 'INVOICED', userId: '', businessLineId: '' });
  const [model, setModel] = useState<Opt | null>(null);
  const un = new Map(users.data?.map((u) => [u.id, u.name]));
  const ln = new Map(lines.data?.map((l) => [l.id, l.name]));
  const editable = can('backoffice.edit');
  return (
    <Card>
      <p className="p-4 text-sm text-slate-500">Em cada factura/recebimento aplica-se a regra mais específica: <b>produto</b> &gt; <b>comercial</b> &gt; <b>linha de negócio</b> &gt; geral. Valor fixo com produto = por unidade; sem produto = por documento. O comercial é o responsável do cliente (ou da proposta).</p>
      <div className="px-4"><Alert>{error}</Alert></div>
      {editable && (
        <form className="grid items-end gap-3 px-4 pb-4 sm:grid-cols-4 lg:grid-cols-8" onSubmit={async (e) => { e.preventDefault(); if (await act('/finance/commission-rules', 'POST', { ...f, productModelId: model?.id ?? null })) { setF({ ...f, name: '', value: '' }); setModel(null); } }}>
          <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Tipo"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(COMMISSION_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label={f.type === 'PERCENT' ? 'Valor (%)' : 'Valor (Kz)'}><Input type="number" min={0} step="any" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          <Field label="Base"><Select value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>{Object.entries(COMMISSION_BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Comercial"><Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Todos</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Linha"><Select value={f.businessLineId} onChange={(e) => setF({ ...f, businessLineId: e.target.value })}><option value="">Todas</option>{lines.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Produto"><ModelSelect value={model} onChange={setModel} /></Field>
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      <Table head={['Regra', 'Valor', 'Base', 'Comercial', 'Linha', 'Estado']} empty={rules.data?.length === 0}>
        {rules.data?.map((r) => (
          <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
            <Td className="font-medium">{r.name}{r.productModelId && <span className="ml-1 text-xs text-slate-500">(produto)</span>}</Td>
            <Td>{r.type === 'PERCENT' ? `${Number(r.value)}%` : formatKz(Number(r.value))}</Td>
            <Td>{COMMISSION_BASE[r.base]}</Td><Td>{r.userId ? un.get(r.userId) : 'Todos'}</Td><Td>{r.businessLineId ? ln.get(r.businessLineId) : 'Todas'}</Td>
            <Td>{editable ? <button onClick={() => act(`/finance/commission-rules/${r.id}`, 'PATCH', { active: !r.active })}>{r.active ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</button> : r.active ? 'Activa' : 'Inactiva'}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Kpis() {
  const { can } = useAuth();
  const kpis = useApi<Kpi[]>('/reports/kpi-definitions');
  const { error, act } = useAction(kpis.reload);
  const editable = can('backoffice.edit');
  return (
    <Card>
      <div className="p-4"><Alert>{error}</Alert></div>
      <Table head={['Indicador', 'Unidade', 'Meta (empresa)', 'Activo']}>
        {kpis.data?.map((k) => {
          const t = k.targets.find((x) => x.userId === null);
          return (
            <tr key={k.key}>
              <Td className="font-medium">{k.name}</Td><Td>{k.unit}</Td>
              <Td className="w-48">
                {editable ? <Input type="number" step="any" defaultValue={t ? Number(t.value) : ''} placeholder="sem meta" onBlur={(e) => act('/reports/kpi-targets', 'PUT', { kpiKey: k.key, value: e.target.value === '' ? null : Number(e.target.value) })} /> : t ? Number(t.value) : '-'}
              </Td>
              <Td><input type="checkbox" disabled={!editable} checked={k.active} onChange={(e) => act(`/reports/kpi-definitions/${k.key}`, 'PATCH', { active: e.target.checked })} /></Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

function Cats() {
  const { can } = useAuth();
  const cats = useApi<{ id: string; name: string; type: string }[]>('/finance/categories');
  const { error, act } = useAction(cats.reload);
  const [f, setF] = useState({ name: '', type: 'EXPENSE' });
  return (
    <Card>
      <div className="p-4"><Alert>{error}</Alert></div>
      {can('backoffice.edit') && (
        <form className="flex gap-2 px-4 pb-4" onSubmit={async (e) => { e.preventDefault(); if (await act('/finance/categories', 'POST', f)) setF({ ...f, name: '' }); }}>
          <Select className="w-36" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option></Select>
          <Input required placeholder="Nova categoria" className="max-w-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      <Table head={['Tipo', 'Categoria']}>
        {cats.data?.map((c) => <tr key={c.id}><Td>{c.type === 'INCOME' ? 'Receita' : 'Despesa'}</Td><Td>{c.name}</Td></tr>)}
      </Table>
    </Card>
  );
}
