import { formatKz, gridTotal, ORDER_STATUS, PO_STATUS, PRIORITY } from '@ivamarg/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ClientSelect } from '../../components/ClientSelect';
import { ModelSelect, modelOpt, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, toDateInput } from '../../lib/format';
import { useAppSettings } from '../../lib/options';
import { useApi } from '../../lib/useApi';
import { DocumentsPanel } from '../documents/DocumentsPage';
import { IssueInvoiceButton } from '../invoices/InvoicesPage';

type Line = { description: string; model: Opt | null; sizeGrid: Record<string, number>; color: string; details: string; quantity: number; unitPrice: number };
type Order = {
  id: string;
  number: string;
  status: keyof typeof ORDER_STATUS;
  priority: keyof typeof PRIORITY;
  deadline: string | null;
  personalizationName: string | null;
  personalizationNotes: string | null;
  notes: string | null;
  total: number;
  client: { id: string; name: string };
  proposal: { id: string; number: string } | null;
  lines: { description: string; sizeGrid: Record<string, number>; color: string | null; details: string | null; quantity: number; unitPrice: number; productModel: { id: string; reference: string; name: string } | null }[];
  productionOrders: { id: string; number: string; status: keyof typeof PO_STATUS }[];
};
type Margin = { sale: number; cost: number; value: number; pct: number; belowMin: boolean; minPct: number; pieces: number };
const LOCKED = ['IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED'];
const lineQty = (l: Line) => (Object.values(l.sizeGrid).some((n) => n > 0) ? gridTotal(l.sizeGrid) : l.quantity);

/** Criação (sem :id) e edição de encomenda, com grelha de tamanhos por linha. */
export function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const res = useApi<Order>(id ? `/orders/${id}` : null);
  const sizes = useAppSettings().data?.orderSizes ?? [];
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ status: 'DRAFT', priority: 'NORMAL', deadline: '', personalizationName: '', personalizationNotes: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([{ description: '', model: null, sizeGrid: {}, color: '', details: '', quantity: 0, unitPrice: 0 }]);
  const margin = useApi<Margin>(id && can('production.view') ? `/production/order-margin/${id}` : null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const o = res.data;

  useEffect(() => {
    if (!o) return;
    setClient(o.client);
    setF({ status: o.status, priority: o.priority, deadline: toDateInput(o.deadline), personalizationName: o.personalizationName ?? '', personalizationNotes: o.personalizationNotes ?? '', notes: o.notes ?? '' });
    setLines(o.lines.map((l) => ({ description: l.description, model: l.productModel ? modelOpt(l.productModel) : null, sizeGrid: l.sizeGrid, color: l.color ?? '', details: l.details ?? '', quantity: l.quantity, unitPrice: l.unitPrice })));
  }, [o]);

  if (res.error) return <Alert>{res.error}</Alert>;
  if (id && !o) return <div className="text-slate-500">A carregar…</div>;

  const editable = id ? can('production.edit') : can('production.create');
  const linesLocked = !!o && (LOCKED.includes(o.status) || o.productionOrders.some((p) => p.status !== 'CANCELLED'));
  const setLine = (i: number, l: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...l } : x)));
  const total = lines.reduce((s, l) => s + lineQty(l) * l.unitPrice, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return setMsg({ tone: 'error', text: 'Seleccione o cliente' });
    // Grelha só com tamanhos preenchidos.
    const cleanLines = lines.map(({ model, ...l }) => ({ ...l, productModelId: model?.id ?? null, sizeGrid: Object.fromEntries(Object.entries(l.sizeGrid).filter(([, n]) => n > 0)) }));
    const body = { ...f, clientId: client.id, deadline: f.deadline || null, ...(!linesLocked && { lines: cleanLines }) };
    try {
      if (id) {
        await api(`/orders/${id}`, { method: 'PATCH', body });
        setMsg({ tone: 'success', text: 'Encomenda guardada.' });
        res.reload();
      } else {
        const created = await api<Order>('/orders', { method: 'POST', body });
        navigate(`/encomendas/${created.id}`, { replace: true });
      }
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    }
  };

  return (
    <>
      <PageHeader title={o ? `Encomenda ${o.number}` : 'Nova encomenda'} />
      <form onSubmit={submit} className="space-y-6">
        <Alert tone={msg?.tone}>{msg?.text}</Alert>
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cliente"><ClientSelect value={client} onChange={setClient} disabled={!!o?.proposal || !editable} /></Field>
          <Field label="Estado">
            <Select disabled={!editable || !id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select disabled={!editable} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Prazo de entrega"><Input type="date" disabled={!editable} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          {o?.proposal && <div className="text-sm"><div className="text-xs text-slate-500">Proposta de origem</div><Link className="text-brand-600 hover:underline" to={`/propostas/${o.proposal.id}`}>{o.proposal.number}</Link></div>}
        </Card>

        {o && (
          <Card className="flex flex-wrap items-center gap-4 p-5 text-sm">
            <div className="flex-1">
              <div className="text-xs text-slate-500">Ordens de produção</div>
              {o.productionOrders.length ? o.productionOrders.map((p) => (
                <Link key={p.id} to={`/producao/ops/${p.id}`} className="mr-3 inline-flex items-center gap-1 text-brand-600 hover:underline">{p.number} <Badge tone={p.status === 'COMPLETED' ? 'green' : p.status === 'CANCELLED' ? 'red' : 'slate'}>{PO_STATUS[p.status]}</Badge></Link>
              )) : <span className="text-slate-500">Nenhuma.</span>}
            </div>
            {margin.data && margin.data.cost > 0 && (
              <div className="text-right">
                <div className="text-xs text-slate-500">Margem (custo real {formatKz(margin.data.cost)})</div>
                <Badge tone={margin.data.belowMin ? 'red' : 'green'}>{formatKz(margin.data.value)} · {margin.data.pct}%</Badge>
                {margin.data.belowMin && <div className="text-xs text-red-600">Abaixo do mínimo ({margin.data.minPct}%)</div>}
              </div>
            )}
            {['READY', 'DELIVERED'].includes(o.status) && <IssueInvoiceButton source="Order" sourceId={o.id} label={o.number} />}
            {can('production.create') && !['READY', 'DELIVERED', 'CANCELLED'].includes(o.status) && (
              <Button type="button" variant="secondary" onClick={async () => {
                try {
                  const created = await api<{ id: string }[]>('/production/orders', { method: 'POST', body: { orderId: o.id } });
                  navigate(`/producao/ops/${created[0].id}`);
                } catch (err) {
                  setMsg({ tone: 'error', text: errMsg(err) });
                }
              }}>Gerar ordem de produção</Button>
            )}
          </Card>
        )}

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Linhas {linesLocked && <span className="font-normal text-slate-500">(fechadas - já há ordem de produção)</span>}</h3>
          <div className="space-y-4">
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3"><Field label="Modelo do catálogo (necessário para produzir)"><ModelSelect value={l.model} disabled={linesLocked || !editable} onChange={(m) => setLine(i, { model: m, ...(m && !l.description && { description: m.raw.name }), ...(m && !l.unitPrice && { unitPrice: m.raw.basePrice }) })} /></Field></div>
                <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
                  <Field label="Modelo / descrição"><Input required disabled={linesLocked || !editable} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
                  <Field label="Preço unit. (Kz)"><Input type="number" min={0} step={1} disabled={linesLocked || !editable} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></Field>
                  {!linesLocked && editable && <Button type="button" variant="secondary" className="self-end" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remover</Button>}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[200px_1fr]">
                  <Field label="Cor"><Input disabled={linesLocked || !editable} value={l.color} onChange={(e) => setLine(i, { color: e.target.value })} placeholder="ex.: Azul-marinho" /></Field>
                  <Field label="Detalhe"><Input disabled={linesLocked || !editable} value={l.details} onChange={(e) => setLine(i, { details: e.target.value })} placeholder="ex.: manga curta, bordado no peito, botões brancos" /></Field>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {sizes.map((s) => (
                    <label key={s} className="w-16 text-center text-xs text-slate-500">
                      {s}
                      <Input type="number" min={0} step={1} disabled={linesLocked || !editable} className="mt-1 px-1 text-center"
                        value={l.sizeGrid[s] ?? ''} onChange={(e) => setLine(i, { sizeGrid: { ...l.sizeGrid, [s]: Number(e.target.value) || 0 } })} />
                    </label>
                  ))}
                  {!Object.values(l.sizeGrid).some((n) => n > 0) && (
                    <label className="w-24 text-center text-xs text-slate-500">
                      Qtd (sem grelha)
                      <Input type="number" min={0} step={1} disabled={linesLocked || !editable} className="mt-1 text-center" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                    </label>
                  )}
                  <div className="ml-auto text-right text-sm">
                    <div className="text-xs text-slate-500">{lineQty(l)} peças</div>
                    <div className="font-medium">{formatKz(lineQty(l) * l.unitPrice)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            {!linesLocked && editable ? <Button type="button" variant="secondary" onClick={() => setLines([...lines, { description: '', model: null, sizeGrid: {}, color: '', details: '', quantity: 0, unitPrice: 0 }])}>+ Linha</Button> : <span />}
            <div className="text-right"><span className="mr-3 text-sm text-slate-500">Total</span><span className="text-lg font-semibold">{formatKz(total)}</span></div>
          </div>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Personalização - nome(s) a bordar/estampar"><Input disabled={!editable} value={f.personalizationName} onChange={(e) => setF({ ...f, personalizationName: e.target.value })} /></Field>
          <Field label="Personalização - logótipo, cores, notas"><Textarea disabled={!editable} value={f.personalizationNotes} onChange={(e) => setF({ ...f, personalizationNotes: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Notas internas"><Textarea disabled={!editable} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        </Card>
        {editable && <div className="flex justify-end"><Button type="submit">{id ? 'Guardar' : 'Criar encomenda'}</Button></div>}
      </form>
      {o && <div className="mt-6"><h3 className="mb-2 text-sm font-semibold">Documentos</h3><DocumentsPanel entity="Order" entityId={o.id} /></div>}
    </>
  );
}
