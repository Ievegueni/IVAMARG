import { formatDate, formatDateTime, formatKz } from '@ivamarg/shared';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, localDate, monthStartDate } from '../../lib/format';
import { useBusinessLines, useUserOptions } from '../../lib/options';
import { useApi } from '../../lib/useApi';

type Col = { key: string; label: string; type: 'text' | 'kz' | 'num' | 'pct' | 'date' };
type Report = { title: string; subtitle: string; sections: { title: string; columns: Col[]; rows: Record<string, string | number | null>[]; totals?: Record<string, number> }[] };
type Kpi = { key: string; name: string; unit: string; value: number | null; target: number | null; ok: boolean | null };

// Paleta validada (azul único: uma série por gráfico).
const BLUE = '#2563eb';

/** Gráfico automático de uma secção: 1.ª coluna de texto × 1.ª coluna de valor (Kz, depois números). Top 12. */
function SectionChart({ s }: { s: Report['sections'][number] }) {
  const cat = s.columns.find((c) => c.key === 'name') ?? s.columns.find((c) => c.type === 'text');
  const val = s.columns.find((c) => c.type === 'kz') ?? s.columns.find((c) => c.type === 'num' || c.type === 'pct');
  if (!cat || !val) return null;
  const data = s.rows
    .map((r) => ({ name: String(r[cat.key] ?? '-'), value: Number(r[val.key] ?? 0) }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  if (data.length < 2) return null;
  const short = (v: number) => (val.type === 'kz' ? (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('pt-PT', { maximumFractionDigits: 1 })}M` : `${Math.round(v / 1e3)}k`) : v.toLocaleString('pt-PT'));
  return (
    <div className="border-b border-slate-100 px-4 pt-3 pb-1" style={{ height: data.length * 34 + 48 }} role="img" aria-label={`${s.title}: ${data.map((d) => `${d.name} ${fmt(d.value, val.type)}`).join('; ')}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tickFormatter={short} tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [fmt(Number(v), val.type), val.label]} />
          <Bar dataKey="value" fill={BLUE} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const fmt = (v: unknown, t: Col['type']) =>
  v === null || v === undefined ? '-' : t === 'kz' ? formatKz(Number(v)) : t === 'pct' ? `${v}%` : t === 'date' ? formatDate(String(v)) : t === 'num' ? Number(v).toLocaleString('pt-PT') : String(v);
const kpiFmt = (v: number | null, unit: string) => (v === null ? '-' : unit === 'Kz' ? formatKz(v) : `${v.toLocaleString('pt-PT')} ${unit}`);

export function ReportsPage() {
  const { can } = useAuth();
  const types = useApi<{ type: string; label: string }[]>('/reports/types');
  const lines = useBusinessLines();
  const users = useUserOptions();
  const [f, setF] = useState({ type: 'production', from: monthStartDate(), to: localDate(), businessLineId: '', userId: '' });
  const q = toQuery({ from: `${f.from}T00:00:00+01:00`, to: `${f.to}T23:59:59.999+01:00`, businessLineId: f.businessLineId, userId: f.userId });
  const data = useApi<Report>(`/reports/data/${f.type}${q}`);
  const kpis = useApi<Kpi[]>(`/reports/kpis${q}`);
  const exportsList = useApi<{ id: string; type: string; format: string; status: string; filename: string | null; createdAt: string; error: string | null }[]>('/reports/exports');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const exp = async (format: 'pdf' | 'xlsx') => {
    try {
      await api('/reports/export', { method: 'POST', body: { type: f.type, format, filters: { from: `${f.from}T00:00:00+01:00`, to: `${f.to}T23:59:59.999+01:00`, businessLineId: f.businessLineId, userId: f.userId } } });
      setMsg({ tone: 'success', text: 'Relatório em preparação. Recebe uma notificação quando estiver pronto.' });
      setTimeout(exportsList.reload, 1500);
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  const download = async (id: string) => {
    try {
      window.location.href = (await api<{ url: string }>(`/reports/exports/${id}/url`)).url;
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };

  return (
    <>
      <PageHeader title="Relatórios e desempenho" actions={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}><Printer size={16} aria-hidden /> Imprimir / apresentar</Button>
          {can('reports.export') && <><Button variant="secondary" onClick={() => exp('pdf')}>Exportar PDF</Button><Button variant="secondary" onClick={() => exp('xlsx')}>Exportar Excel</Button></>}
        </div>
      } />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5 print:hidden">
        <Field label="Relatório"><Select value={f.type} onChange={set('type')}>{types.data?.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select></Field>
        <Field label="De"><Input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="Até"><Input type="date" value={f.to} onChange={set('to')} /></Field>
        <Field label="Linha de negócio"><Select value={f.businessLineId} onChange={set('businessLineId')}><option value="">Todas</option>{lines.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        {can('reports.viewAll') && <Field label="Utilizador"><Select value={f.userId} onChange={set('userId')}><option value="">Todos</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>}
      </div>
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text}</Alert></div>

      <Card className="mb-6 p-4">
        <h3 className="mb-3 text-sm font-semibold">Indicadores (KPIs) do período</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.data?.map((k) => (
            <div key={k.key} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{k.name}</div>
              <div className="mt-1 text-lg font-semibold">{kpiFmt(k.value, k.unit)}</div>
              {k.target !== null && (
                <>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100" role="progressbar" aria-valuenow={k.value ?? 0} aria-valuemax={k.target}>
                    <div className={`h-1.5 rounded-full ${k.ok ? 'bg-green-600' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, k.target ? ((k.value ?? 0) / k.target) * 100 : 0)}%` }} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">Meta {kpiFmt(k.target, k.unit)} {k.ok !== null && <Badge tone={k.ok ? 'green' : 'red'}>{k.ok ? 'Cumprida' : 'Abaixo'}</Badge>}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Alert>{data.error}</Alert>
      {data.data && (
        <div className="space-y-6">
          <div><h2 className="text-lg font-semibold">{data.data.title}</h2><p className="text-sm text-slate-500">{data.data.subtitle}</p></div>
          {data.data.sections.map((s) => (
            <Card key={s.title}>
              <h3 className="px-4 pt-4 text-sm font-semibold">{s.title}</h3>
              <SectionChart s={s} />
              <Table head={s.columns.map((c) => c.label)} empty={s.rows.length === 0}>
                {s.rows.map((r, i) => (
                  <tr key={i}>{s.columns.map((c) => <Td key={c.key} className={['kz', 'num', 'pct'].includes(c.type) ? 'text-right whitespace-nowrap' : ''}>{fmt(r[c.key], c.type)}</Td>)}</tr>
                ))}
                {s.totals && s.rows.length > 0 && (
                  <tr className="bg-slate-50 font-semibold">{s.columns.map((c, i) => <Td key={c.key} className={['kz', 'num', 'pct'].includes(c.type) ? 'text-right whitespace-nowrap' : ''}>{i === 0 ? 'Total' : c.key in s.totals! ? fmt(s.totals![c.key], c.type) : ''}</Td>)}</tr>
                )}
              </Table>
            </Card>
          ))}
        </div>
      )}

      {(exportsList.data?.length ?? 0) > 0 && (
        <Card className="mt-6 print:hidden">
          <h3 className="px-4 pt-4 text-sm font-semibold">As minhas exportações</h3>
          <Table head={['Pedido', 'Ficheiro', 'Estado', '']}>
            {exportsList.data?.map((e) => (
              <tr key={e.id}>
                <Td>{formatDateTime(e.createdAt)}</Td><Td>{e.filename ?? `${e.type}.${e.format}`}</Td>
                <Td>{e.status === 'READY' ? <Badge tone="green">Pronto</Badge> : e.status === 'FAILED' ? <Badge tone="red">Falhou</Badge> : <Badge tone="amber">Em preparação</Badge>}</Td>
                <Td className="text-right">{e.status === 'READY' && <button className="text-brand-600 hover:underline" onClick={() => download(e.id)}>Descarregar</button>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
