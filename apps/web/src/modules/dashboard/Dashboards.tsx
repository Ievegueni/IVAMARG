import { LogoMark } from '../../components/Logo';
import { formatDate, formatKz, PROPOSAL_STATUS, type ProposalStatus } from '@ivamarg/shared';
import { Activity, ChevronRight, ClipboardList, Clock, Factory, Inbox, PackageOpen, ShieldAlert, Target, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Card, PageHeader, Tabs } from '../../components/ui';
import { formatQty } from '../../lib/format';
import { useApi } from '../../lib/useApi';

// Paleta validada (dataviz/validate_palette, modo claro): azul + âmbar, legenda sempre presente.
const C = { blue: '#1d4ed8', amber: '#d97706', grid: '#e2e8f0', ink: '#475569' };

type Stage = { stageId: string; name: string; waiting: number; inProgress: number; lots: number };
type Prod = {
  stages: Stage[]; bottleneck: string | null; openLots: number; piecesToday: number;
  ops: { id: string; number: string; client: string; orderNumber: string; deadline: string | null; quantity: number; done: number; progress: number }[];
  lateOrders: { id: string; number: string; deadline: string; client: { name: string } }[];
};
type Stock = { belowMin: number; low: { id: string; code: string; name: string; unit: string; minStock: number; available: number }[]; overConsumption: { po: { id: string; number: string }; item: { code: string; name: string }; pct: number }[] };
type Com = {
  pipelineValue: number; openOpportunities: number; byStage: { stage: string; count: number; value: number }[]; wonThisMonth: { count: number; value: number };
  conversion90: number | null; pendingApproval: number; proposalsOpen: { id: string; number: string; title: string; status: ProposalStatus; total: number; client: { name: string } }[];
};
type Direction = {
  production: Prod; stock: Stock; commercial: Com;
  quality: { inspected: number; scrap: number; rework: number; defectRate: number; topDefects: { name: string; quantity: number }[] };
  documents: { id: string; title: string; expiresAt: string; category: { name: string } }[];
  margins: { id: string; number: string; client: { name: string }; sale: number; cost: number; pct: number; belowMin: boolean }[];
  ranking: { name: string; pieces: number; rejected: number }[];
};
type Tasks = { items: { id: string; title: string; dueAt: string | null }[]; overdue: number };

const CHIP = { blue: 'bg-blue-50 text-blue-600', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', green: 'bg-green-50 text-green-600', slate: 'bg-slate-100 text-slate-600' };
const Stat = ({ label, value, hint, tone, icon: Icon, chip = 'blue' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'red' | 'amber'; icon?: LucideIcon; chip?: keyof typeof CHIP }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {Icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CHIP[tone ?? chip]}`}><Icon size={16} aria-hidden /></span>}
    </div>
    <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
    {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
  </Card>
);
const Section = ({ title, children, link }: { title: string; children: ReactNode; link?: [string, string] }) => (
  <Card className="p-4">
    <div className="mb-3 flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{link && <Link to={link[0]} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:text-brand-700">{link[1]}<ChevronRight size={14} aria-hidden /></Link>}</div>
    {children}
  </Card>
);
const Empty = () => <p className="flex items-center gap-2 py-4 text-sm text-slate-400"><Inbox size={16} aria-hidden /> Nada a mostrar.</p>;

function StagesChart({ stages }: { stages: Stage[] }) {
  if (!stages.some((s) => s.waiting || s.inProgress)) return <Empty />;
  return (
    <div className="h-64" role="img" aria-label={`Peças por etapa: ${stages.map((s) => `${s.name} ${s.waiting} à espera, ${s.inProgress} em curso`).join('; ')}`}>
      <ResponsiveContainer>
        <BarChart data={stages} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.ink }} interval={0} tickLine={false} axisLine={{ stroke: C.grid }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.ink }} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v, n) => [`${v} pç`, n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="inProgress" name="Em curso" stackId="s" fill={C.blue} stroke="#fff" strokeWidth={2} />
          <Bar dataKey="waiting" name="À espera" stackId="s" fill={C.amber} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PipelineChart({ data }: { data: Com['byStage'] }) {
  if (!data.length) return <Empty />;
  return (
    <div className="h-56" role="img" aria-label={`Pipeline por estado: ${data.map((d) => `${d.stage} ${formatKz(d.value)}`).join('; ')}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: C.ink }} tickFormatter={(v) => `${Math.round(v / 1e6)}M`} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="stage" width={120} tick={{ fontSize: 11, fill: C.ink }} tickLine={false} axisLine={{ stroke: C.grid }} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v, _n, p) => [`${formatKz(Number(v))} (${p.payload.count} oport.)`, 'Valor']} />
          <Bar dataKey="value" name="Valor previsto" fill={C.blue} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function OpsList({ ops }: { ops: Prod['ops'] }) {
  if (!ops.length) return <Empty />;
  return (
    <ul className="space-y-2 text-sm">
      {ops.map((o) => (
        <li key={o.id}>
          <div className="flex justify-between"><Link to={`/producao/ops/${o.id}`} className="font-medium text-brand-600 hover:underline">{o.number}</Link><span className="text-slate-500">{o.client}{o.deadline && ` · ${formatDate(o.deadline)}`}</span></div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-slate-100" role="progressbar" aria-valuenow={o.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full" style={{ width: `${o.progress}%`, background: C.blue }} /></div>
            <span className="w-24 text-right text-xs text-slate-600">{o.done}/{o.quantity} pç</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StockLists({ s }: { s: Stock }) {
  return (
    <div className="space-y-3 text-sm">
      {s.low.length ? (
        <ul className="space-y-1">{s.low.map((i) => <li key={i.id} className="flex justify-between"><span><span className="font-mono text-xs">{i.code}</span> {i.name}</span><Badge tone="red">{formatQty(i.available)}/{formatQty(i.minStock)} {i.unit}</Badge></li>)}</ul>
      ) : <p className="text-slate-500">Sem artigos abaixo do mínimo.</p>}
      {s.overConsumption.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Consumo acima do previsto</div>
          <ul className="space-y-1">{s.overConsumption.map((r, i) => <li key={i} className="flex justify-between"><span><Link to={`/producao/ops/${r.po.id}`} className="text-brand-600 hover:underline">{r.po.number}</Link> · {r.item.code}</span><Badge tone="amber">+{r.pct}%</Badge></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function DirectionDash() {
  const r = useApi<Direction>('/dashboard/direction');
  if (r.error) return <Alert>{r.error}</Alert>;
  const d = r.data;
  if (!d) return <div className="text-slate-500">A carregar…</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <Stat icon={Factory} label="Produção de hoje" value={`${d.production.piecesToday} pç`} hint={`${d.production.ops.length} OP(s) em curso`} />
        <Stat icon={Activity} chip="slate" label="Gargalo" value={d.production.bottleneck ?? '-'} hint={`${d.production.openLots} lotes abertos`} />
        <Stat icon={Clock} chip="green" label="Encomendas em atraso" value={d.production.lateOrders.length} tone={d.production.lateOrders.length ? 'red' : undefined} />
        <Stat icon={ShieldAlert} chip="green" label="Taxa de defeito (30 d)" value={`${d.quality.defectRate}%`} hint={`${d.quality.inspected} inspeccionadas · ${d.quality.scrap} refugo`} tone={d.quality.defectRate > 5 ? 'amber' : undefined} />
        <Stat icon={PackageOpen} chip="green" label="Stock crítico" value={d.stock.belowMin} tone={d.stock.belowMin ? 'red' : undefined} hint="artigos abaixo do mínimo" />
        <Stat icon={TrendingUp} label="Pipeline aberto" value={formatKz(d.commercial.pipelineValue)} hint={`Ganho este mês: ${formatKz(d.commercial.wonThisMonth.value)}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Lotes por etapa (peças)" link={['/producao/ops', 'Ordens de produção']}><StagesChart stages={d.production.stages} /></Section>
        <Section title="OPs em curso"><OpsList ops={d.production.ops} /></Section>
        <Section title="Pipeline por estado" link={['/pipeline', 'Abrir pipeline']}>
          <PipelineChart data={d.commercial.byStage} />
          <p className="mt-2 text-xs text-slate-500">Conversão (90 d): {d.commercial.conversion90 ?? '-'}{d.commercial.conversion90 !== null && '%'} · Propostas a aprovar: {d.commercial.pendingApproval}</p>
        </Section>
        <Section title="Stock" link={['/stock?belowMin=1', 'Ver stock']}><StockLists s={d.stock} /></Section>
        <Section title="Margens das encomendas recentes">
          {d.margins.length ? (
            <ul className="space-y-1 text-sm">{d.margins.map((m) => <li key={m.id} className="flex justify-between"><Link to={`/encomendas/${m.id}`} className="text-brand-600 hover:underline">{m.number} · {m.client.name}</Link><Badge tone={m.belowMin ? 'red' : 'green'}>{m.cost ? `${m.pct}%` : 'sem custos'}</Badge></li>)}</ul>
          ) : <Empty />}
        </Section>
        <Section title="Produtividade (7 dias, todas as etapas)" link={['/producao/pagamentos', 'Pagamento à peça']}>
          {d.ranking.length ? (
            <ol className="space-y-1 text-sm">{d.ranking.map((o, i) => <li key={o.name} className="flex justify-between"><span>{i + 1}. {o.name}</span><span>{o.pieces} pç processadas{o.rejected ? <span className="text-red-600"> · {o.rejected} rej.</span> : ''}</span></li>)}</ol>
          ) : <Empty />}
        </Section>
        <Section title="Qualidade - defeitos mais frequentes (30 d)">
          {d.quality.topDefects.length ? <ul className="space-y-1 text-sm">{d.quality.topDefects.map((x) => <li key={x.name} className="flex justify-between"><span>{x.name}</span><span>{x.quantity}</span></li>)}</ul> : <Empty />}
        </Section>
        <Section title="Documentos a expirar (30 dias)" link={['/documentos', 'Documentos']}>
          {d.documents.length ? <ul className="space-y-1 text-sm">{d.documents.map((x) => <li key={x.id} className="flex justify-between"><Link to={`/documentos?id=${x.id}`} className="text-brand-600 hover:underline">{x.title}</Link><Badge tone={new Date(x.expiresAt) < new Date() ? 'red' : 'amber'}>{formatDate(x.expiresAt)}</Badge></li>)}</ul> : <Empty />}
        </Section>
        {d.production.lateOrders.length > 0 && (
          <Section title="Encomendas em atraso">
            <ul className="space-y-1 text-sm">{d.production.lateOrders.map((o) => <li key={o.id} className="flex justify-between"><Link to={`/encomendas/${o.id}`} className="text-brand-600 hover:underline">{o.number} · {o.client.name}</Link><Badge tone="red">{formatDate(o.deadline)}</Badge></li>)}</ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function CommercialDash() {
  const r = useApi<Com & { tasks: Tasks; clients: number }>('/dashboard/commercial');
  if (r.error) return <Alert>{r.error}</Alert>;
  const d = r.data;
  if (!d) return <div className="text-slate-500">A carregar…</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={Users} label="A minha carteira" value={d.clients} hint="clientes" />
        <Stat icon={Target} label="Oportunidades abertas" value={d.openOpportunities} hint={formatKz(d.pipelineValue)} />
        <Stat icon={TrendingUp} chip="green" label="Ganho este mês" value={formatKz(d.wonThisMonth.value)} hint={`${d.wonThisMonth.count} oportunidade(s)`} />
        <Stat icon={Clock} chip="green" label="Tarefas em atraso" value={d.tasks.overdue} tone={d.tasks.overdue ? 'red' : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="As minhas oportunidades por estado" link={['/pipeline', 'Pipeline']}><PipelineChart data={d.byStage} /></Section>
        <Section title="Propostas em curso" link={['/propostas', 'Propostas']}>
          {d.proposalsOpen.length ? <ul className="space-y-1 text-sm">{d.proposalsOpen.map((p) => <li key={p.id} className="flex justify-between gap-2"><Link to={`/propostas/${p.id}`} className="text-brand-600 hover:underline">{p.number} · {p.client.name}</Link><span className="text-right text-xs text-slate-500">{PROPOSAL_STATUS[p.status]} · {formatKz(p.total)}</span></li>)}</ul> : <Empty />}
        </Section>
        <Section title="As minhas tarefas" link={['/tarefas', 'Tarefas']}>
          {d.tasks.items.length ? <ul className="space-y-1 text-sm">{d.tasks.items.map((t) => <li key={t.id} className="flex justify-between"><span>{t.title}</span>{t.dueAt && <span className={new Date(t.dueAt) < new Date() ? 'text-red-600' : 'text-slate-500'}>{formatDate(t.dueAt)}</span>}</li>)}</ul> : <Empty />}
        </Section>
      </div>
    </div>
  );
}

function ProductionDash() {
  const r = useApi<Prod & { draftOps: number; stock: Stock }>('/dashboard/production');
  if (r.error) return <Alert>{r.error}</Alert>;
  const d = r.data;
  if (!d) return <div className="text-slate-500">A carregar…</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={Factory} label="Produção de hoje" value={`${d.piecesToday} pç`} />
        <Stat icon={ClipboardList} label="OPs em curso" value={d.ops.length} hint={d.draftOps ? `${d.draftOps} por libertar` : undefined} />
        <Stat icon={Activity} chip="slate" label="Gargalo" value={d.bottleneck ?? '-'} />
        <Stat icon={PackageOpen} chip="green" label="Material abaixo do mínimo" value={d.stock.belowMin} tone={d.stock.belowMin ? 'red' : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Lotes por etapa (peças)"><StagesChart stages={d.stages} /></Section>
        <Section title="OPs em curso" link={['/producao/ops', 'Todas']}><OpsList ops={d.ops} /></Section>
        <Section title="Faltas e consumo" link={['/stock?belowMin=1', 'Stock']}><StockLists s={d.stock} /></Section>
      </div>
    </div>
  );
}

export function HomePage() {
  const { user, can } = useAuth();
  const tabs = ([
    can('reports.viewAll') && ['direction', 'Direcção'],
    can('pipeline.view') && ['commercial', 'Comercial'],
    can('production.view') && ['production', 'Produção'],
  ].filter(Boolean) as ['direction' | 'commercial' | 'production', string][]);
  const [tab, setTab] = useState(tabs[0]?.[0]);
  return (
    <>
      <PageHeader
        title={`Olá, ${user?.name}`}
        actions={
          <div className="text-center" role="img" aria-label="Ivamarg">
            <LogoMark className="mx-auto w-24" diamond="#1f1f23" />
            <p className="mt-1 pl-[0.3em] text-sm font-semibold tracking-[0.3em] text-[#1f1f23]">IVAMARG</p>
          </div>
        }
      />
      {tabs.length > 1 && <Tabs value={tab!} onChange={setTab} tabs={tabs} />}
      {tab === 'direction' && <DirectionDash />}
      {tab === 'commercial' && <CommercialDash />}
      {tab === 'production' && <ProductionDash />}
      {!tabs.length && <Card className="p-6 text-slate-600">Sem painéis disponíveis para o seu perfil.</Card>}
    </>
  );
}
