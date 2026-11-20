import { COMMISSION_STATUS, formatDate, formatKz, PAYMENT_METHODS, RECEIVABLE_STATUS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ClientSelect } from '../../components/ClientSelect';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Pagination, Select, Table, Tabs, Td } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, localDate, monthStartDate } from '../../lib/format';
import { useBusinessLines, useUserOptions } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';

type Rec = { id: string; clientId: string; clientName?: string; description: string; amount: number; paid: number; balance: number; dueDate: string | null; status: keyof typeof RECEIVABLE_STATUS; invoice: { number: string | null } | null };
type RecDetail = Rec & { payments: { id: string; amount: number; method: keyof typeof PAYMENT_METHODS; paidAt: string; reference: string | null; cancelledAt: string | null }[] };
const tone = (s: Rec['status']) => (s === 'PAID' ? 'green' : s === 'OVERDUE' ? 'red' : s === 'PARTIAL' ? 'amber' : 'slate');

export function FinancePage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const tabs = ([
    can('finance.viewAll') && ['dash', 'Painel'],
    ['receivables', 'Contas a receber'],
    can('finance.viewAll') && ['entries', 'Receitas e despesas'],
    ['commissions', 'Comissões'],
  ].filter(Boolean) as ['dash' | 'receivables' | 'entries' | 'commissions', string][]);
  const [tab, setTab] = useState(params.get('status') ? 'receivables' : tabs[0][0]);
  return (
    <>
      <PageHeader title="Financeiro" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'dash' && <FinanceDash />}
      {tab === 'receivables' && <Receivables initialStatus={params.get('status') ?? 'OPEN_ALL'} />}
      {tab === 'entries' && <Entries />}
      {tab === 'commissions' && <Commissions />}
    </>
  );
}

function FinanceDash() {
  const r = useApi<{ openTotal: number; overdueTotal: number; aging: Record<string, number>; monthIncome: number; monthExpense: number; commissions: Record<string, number>; topDebtors: { id: string; name: string; amount: number }[] }>('/finance/dashboard');
  if (r.error) return <Alert>{r.error}</Alert>;
  const d = r.data;
  if (!d) return <div className="text-slate-500">A carregar…</div>;
  const stat = (label: string, v: number, t?: 'red') => <Card className="p-4"><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 text-xl font-semibold ${t === 'red' && v ? 'text-red-700' : ''}`}>{formatKz(v)}</div></Card>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {stat('Em aberto', d.openTotal)}
        {stat('Em atraso', d.overdueTotal, 'red')}
        {stat('Recebido este mês', d.monthIncome)}
        {stat('Despesas este mês', d.monthExpense)}
        {stat('Comissões por aprovar', d.commissions.CALCULATED ?? 0)}
        {stat('Comissões por pagar', d.commissions.APPROVED ?? 0)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Antiguidade da dívida</h3>
          <Table head={['Atraso', 'Valor']}>
            {([['current', 'Por vencer'], ['d30', '1-30 dias'], ['d60', '31-60 dias'], ['d90', '61-90 dias'], ['over90', '+90 dias']] as const).map(([k, l]) => (
              <tr key={k}><Td>{l}</Td><Td className={`text-right ${k !== 'current' && d.aging[k] ? 'text-red-700' : ''}`}>{formatKz(d.aging[k])}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Maiores devedores</h3>
          {d.topDebtors.length ? <ul className="space-y-1 text-sm">{d.topDebtors.map((x) => <li key={x.id} className="flex justify-between"><Link to={`/clientes/${x.id}`} className="text-brand-600 hover:underline">{x.name}</Link><span>{formatKz(x.amount)}</span></li>)}</ul> : <p className="text-sm text-slate-500">Sem dívidas.</p>}
        </Card>
      </div>
    </div>
  );
}

function Receivables({ initialStatus }: { initialStatus: string }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(initialStatus);
  const list = useApi<Page<Rec> & { totals: { amount: number; paid: number } }>(`/finance/receivables${toQuery({ page, status })}`);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="OPEN_ALL">Por receber</option>
          <option value="OVERDUE">Em atraso</option>
          <option value="PAID">Pagas</option>
          <option value="">Todas</option>
        </Select>
        {list.data && <span className="text-sm text-slate-600">Total {formatKz(list.data.totals.amount)} · recebido {formatKz(list.data.totals.paid)} · <b>saldo {formatKz(list.data.totals.amount - list.data.totals.paid)}</b></span>}
        {can('finance.create') && <Button className="ml-auto" variant="secondary" onClick={() => setCreating(true)}>Conta manual</Button>}
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Cliente', 'Documento', 'Vencimento', 'Valor', 'Recebido', 'Saldo', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(r.id)}>
              <Td className="font-medium">{r.clientName}</Td><Td>{r.description}</Td><Td>{r.dueDate ? formatDate(r.dueDate) : '-'}</Td>
              <Td className="text-right">{formatKz(r.amount)}</Td><Td className="text-right">{formatKz(r.paid)}</Td><Td className="text-right font-medium">{formatKz(r.balance)}</Td>
              <Td><Badge tone={tone(r.status)}>{RECEIVABLE_STATUS[r.status]}</Badge></Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {open && <ReceivableModal id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {creating && <NewReceivable onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />}
    </>
  );
}

function ReceivableModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const r = useApi<RecDetail>(`/finance/receivables/${id}`);
  const [f, setF] = useState({ amount: '', method: 'TRANSFER', paidAt: localDate(), reference: '' });
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const d = r.data;
  const pay = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/finance/receivables/${id}/payments`, { method: 'POST', body: { ...f, amount: Number(f.amount || d!.balance) } });
      setF({ ...f, amount: '', reference: '' });
      setError('');
      r.reload();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={d ? `${d.description}` : 'Conta a receber'} onClose={onClose}>
      {!d ? <div className="text-slate-500">{r.error ?? 'A carregar…'}</div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Valor</div>{formatKz(d.amount)}</div>
            <div><div className="text-xs text-slate-500">Recebido</div>{formatKz(d.paid)}</div>
            <div><div className="text-xs text-slate-500">Saldo</div><b>{formatKz(d.balance)}</b></div>
            <div><div className="text-xs text-slate-500">Vencimento</div>{d.dueDate ? formatDate(d.dueDate) : '-'}</div>
            <div><div className="text-xs text-slate-500">Estado</div><Badge tone={tone(d.status)}>{RECEIVABLE_STATUS[d.status]}</Badge></div>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Pagamentos</h4>
            {d.payments.length === 0 && <p className="text-sm text-slate-500">Nenhum.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className={`flex items-center justify-between py-1.5 ${p.cancelledAt ? 'text-slate-400 line-through' : ''}`}>
                  <span>{formatDate(p.paidAt)} · {PAYMENT_METHODS[p.method]}{p.reference && ` · ${p.reference}`}</span>
                  <span className="flex items-center gap-3">{formatKz(p.amount)}{!p.cancelledAt && can('finance.delete') && <button className="text-xs text-red-600 no-underline hover:underline" onClick={() => setCancelling(p.id)}>Anular</button>}</span>
                </li>
              ))}
            </ul>
          </div>
          {d.balance > 0 && can('finance.create') && (
            <form onSubmit={pay} className="space-y-3 rounded-lg bg-slate-50 p-3">
              <h4 className="text-sm font-semibold">Registar pagamento</h4>
              <Alert>{error}</Alert>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Valor (Kz)"><Input type="number" min={1} max={d.balance} step={1} placeholder={String(d.balance)} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
                <Field label="Data"><Input type="date" required value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
                <Field label="Método"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Referência"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
              </div>
              <Button type="submit">Registar {f.amount ? formatKz(Number(f.amount)) : `saldo (${formatKz(d.balance)})`}</Button>
            </form>
          )}
        </div>
      )}
      {cancelling && <ConfirmModal title="Anular pagamento" danger message="O saldo em dívida é reposto e a receita correspondente é removida." onClose={() => setCancelling(null)} onConfirm={async () => { await api(`/finance/payments/${cancelling}/cancel`, { method: 'POST' }); r.reload(); onChanged(); }} />}
    </Modal>
  );
}

function NewReceivable({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ description: '', amount: '', dueDate: '' });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return setError('Seleccione o cliente');
    try {
      await api('/finance/receivables', { method: 'POST', body: { ...f, clientId: client.id, dueDate: f.dueDate || null } });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title="Conta a receber manual" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-xs text-slate-500">Para dívidas anteriores à plataforma ou facturadas fora dela. Facturas emitidas pela plataforma criam a conta automaticamente.</p>
        <Field label="Cliente"><ClientSelect value={client} onChange={setClient} /></Field>
        <Field label="Descrição"><Input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="ex.: Factura FT 2025/123" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor (Kz)"><Input type="number" min={1} step={1} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Vencimento"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Criar</Button></div>
      </form>
    </Modal>
  );
}

type Entry = { id: string; type: 'INCOME' | 'EXPENSE'; amount: number; date: string; description: string; paymentId: string | null; category: { name: string }; businessLineId: string | null };
function Entries() {
  const { can } = useAuth();
  const lines = useBusinessLines();
  const cats = useApi<{ id: string; name: string; type: string; active: boolean }[]>('/finance/categories');
  const [page, setPage] = useState(1);
  const monthStart = monthStartDate();
  const [f, setF] = useState({ type: '', from: monthStart, to: localDate(), businessLineId: '' });
  const list = useApi<Page<Entry> & { totals: { income: number; expense: number; net: number } }>(`/finance/entries${toQuery({ page, ...f, from: f.from && `${f.from}T00:00:00Z`, to: f.to && `${f.to}T00:00:00Z` })}`);
  const [form, setForm] = useState({ type: 'EXPENSE', categoryId: '', amount: '', date: localDate(), description: '', businessLineId: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/finance/entries', { method: 'POST', body: form });
      setForm({ ...form, amount: '', description: '' });
      setError('');
      list.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Select value={f.type} onChange={set('type')}><option value="">Receitas e despesas</option><option value="INCOME">Receitas</option><option value="EXPENSE">Despesas</option></Select>
        <Input type="date" value={f.from} onChange={set('from')} />
        <Input type="date" value={f.to} onChange={set('to')} />
        <Select value={f.businessLineId} onChange={set('businessLineId')}><option value="">Todas as linhas</option>{lines.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
      </div>
      {list.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-4"><div className="text-xs text-slate-500">Receitas</div><div className="text-xl font-semibold">{formatKz(list.data.totals.income)}</div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">Despesas</div><div className="text-xl font-semibold">{formatKz(list.data.totals.expense)}</div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">Resultado</div><div className={`text-xl font-semibold ${list.data.totals.net < 0 ? 'text-red-700' : ''}`}>{formatKz(list.data.totals.net)}</div></Card>
        </div>
      )}
      {can('finance.create') && (
        <Card className="p-4">
          <form onSubmit={add} className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Field label="Tipo"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, categoryId: '' })}><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option></Select></Field>
            <Field label="Categoria"><Select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">-</option>{cats.data?.filter((c) => c.type === form.type && c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Valor (Kz)"><Input type="number" min={1} step={1} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Data"><Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Linha"><Select value={form.businessLineId} onChange={(e) => setForm({ ...form, businessLineId: e.target.value })}><option value="">-</option>{lines.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Descrição"><Input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Button type="submit">Registar</Button>
          </form>
          <div className="mt-2"><Alert>{error}</Alert></div>
        </Card>
      )}
      <Card>
        <Table head={['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((e) => (
            <tr key={e.id}>
              <Td>{formatDate(e.date)}</Td><Td>{e.type === 'INCOME' ? <Badge tone="green">Receita</Badge> : <Badge tone="red">Despesa</Badge>}</Td>
              <Td>{e.category.name}</Td><Td>{e.description}{e.paymentId && <span className="ml-1 text-xs text-slate-400">(automático)</span>}</Td>
              <Td className="text-right">{formatKz(e.amount)}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </div>
  );
}

type Comm = { id: string; userId: string; userName?: string; period: string; sourceType: string; baseAmount: number; amount: number; status: keyof typeof COMMISSION_STATUS; rule: { name: string } | null };
function Commissions() {
  const { can } = useAuth();
  const users = useUserOptions();
  const [period, setPeriod] = useState(localDate().slice(0, 7));
  const [userId, setUserId] = useState('');
  const list = useApi<{ items: Comm[]; summary: { userId: string; name: string; count: number; base: number; amount: number; approved: number; paid: number }[] }>(`/finance/commissions${toQuery({ period, userId })}`);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      list.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  const ids = (status: string) => list.data?.items.filter((c) => c.status === status).map((c) => c.id) ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Período"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        {can('finance.viewAll') && <Field label="Comercial"><Select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Todos</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>}
        {can('finance.edit') && <Button variant="secondary" onClick={() => act(() => api('/finance/commissions/calculate', { method: 'POST', body: { period } }), 'Comissões recalculadas (aprovadas e pagas não são alteradas).')}>Calcular período</Button>}
        {can('finance.approve') && ids('CALCULATED').length > 0 && <Button onClick={() => act(() => api('/finance/commissions/status', { method: 'POST', body: { ids: ids('CALCULATED'), status: 'APPROVED' } }), 'Comissões aprovadas.')}>Aprovar todas ({ids('CALCULATED').length})</Button>}
        {can('finance.approve') && ids('APPROVED').length > 0 && <Button onClick={() => act(() => api('/finance/commissions/status', { method: 'POST', body: { ids: ids('APPROVED'), status: 'PAID' } }), 'Marcadas como pagas.')}>Marcar pagas ({ids('APPROVED').length})</Button>}
      </div>
      <Alert tone={msg?.tone}>{msg?.text ?? list.error}</Alert>
      <Card>
        <Table head={['Comercial', 'Documentos', 'Base', 'Comissão', 'Aprovada', 'Paga']} empty={list.data?.summary.length === 0}>
          {list.data?.summary.map((s) => (
            <tr key={s.userId}><Td className="font-medium">{s.name}</Td><Td className="text-right">{s.count}</Td><Td className="text-right">{formatKz(s.base)}</Td><Td className="text-right font-semibold">{formatKz(s.amount)}</Td><Td className="text-right">{formatKz(s.approved)}</Td><Td className="text-right">{formatKz(s.paid)}</Td></tr>
          ))}
        </Table>
      </Card>
      <Card>
        <Table head={['Comercial', 'Origem', 'Regra', 'Base', 'Comissão', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((c) => (
            <tr key={c.id}><Td>{c.userName}</Td><Td>{c.sourceType === 'Invoice' ? 'Factura' : 'Recebimento'}</Td><Td>{c.rule?.name ?? '-'}</Td><Td className="text-right">{formatKz(c.baseAmount)}</Td><Td className="text-right">{formatKz(c.amount)}</Td><Td><Badge tone={c.status === 'PAID' ? 'green' : c.status === 'APPROVED' ? 'amber' : 'slate'}>{COMMISSION_STATUS[c.status]}</Badge></Td></tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
