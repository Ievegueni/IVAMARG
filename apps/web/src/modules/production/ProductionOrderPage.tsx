import { formatDate, formatDateTime, formatKz, PO_STATUS, STAGE_TYPE } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { SupplierSelect, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Select, Table, Td } from '../../components/ui';
import { api, ApiError, openFile } from '../../lib/api';
import { errMsg, formatQty } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { poTone } from './ProductionOrdersPage';
import { FinishForm, type FinishBody, type StageInfo } from './StageForms';

type Flow = { stageId: string; inflow: number; started: number; inProgress: number; done: number; rejected: number; available: number };
type Log = {
  id: string; stageId: string; qtyIn: number; qtyDone: number; qtyRejected: number; qtyRework: number; cost: number; labourCost: number;
  startedAt: string; finishedAt: string | null; stage: { name: string; type: string }; operator: { name: string } | null; supplier: { name: string } | null;
  defects: { quantity: number; defectType: { name: string } }[];
};
type Lot = { id: string; number: string; size: string | null; quantity: number; status: string; finished: number; scrapped: number; complete: boolean; productModel: { reference: string; name: string }; flow: Flow[]; logs: Log[] };
type PO = {
  id: string; number: string; status: keyof typeof PO_STATUS; quantity: number; releasedAt: string | null; completedAt: string | null;
  order: { id: string; number: string; deadline: string | null; total: number; client: { id: string; name: string } };
  items: { id: string; quantity: number; sizeGrid: Record<string, number>; productModel: { reference: string; name: string }; orderLine: { color: string | null; details: string | null } }[];
  stages: StageInfo[];
  lots: Lot[];
  shortages: { itemId: string; code: string; name: string; unit: string; required: number; available: number; shortage: number }[];
  consumption: { itemId: string; code: string; name: string; unit: string; required: number; reserved: number; issued: number; issuedCost: number; deviationPct: number }[];
  costs: { material: number; labour: number; external: number; total: number; pieces: number; perPiece: number };
};

export function ProductionOrderPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const res = useApi<PO>(`/production/orders/${id}`);
  const ops = useApi<{ id: string; name: string; active: boolean }[]>('/production/config/operators');
  const defects = useApi<{ id: string; name: string; active: boolean }[]>('/production/config/defect-types');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const [modal, setModal] = useState<'shortage' | 'issue' | 'complete' | 'cancel' | null>(null);
  const [shortErr, setShortErr] = useState<PO['shortages']>([]);
  const [lotId, setLotId] = useState<string | null>(null);
  const po = res.data;
  if (res.error) return <Alert>{res.error}</Alert>;
  if (!po) return <div className="text-slate-500">A carregar…</div>;
  const lot = po.lots.find((l) => l.id === lotId);

  const act = async (path: string, body?: unknown, ok?: string) => {
    setMsg(undefined);
    try {
      await api(`/production/orders/${id}/${path}`, { method: 'POST', body });
      if (ok) setMsg({ tone: 'success', text: ok });
      res.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SHORTAGE') {
        setShortErr(e.details as unknown as PO['shortages']);
        setModal('shortage');
      } else setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  const editable = can('production.edit');

  return (
    <>
      <PageHeader
        title={`Ordem de produção ${po.number}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {po.status === 'DRAFT' && editable && <Button onClick={() => act('release', {}, 'OP libertada: material reservado e lotes criados.')}>Libertar para produção</Button>}
            <Button variant="secondary" onClick={() => openFile(`/production/orders/${id}/pdf`).catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))}>Imprimir OP (PDF)</Button>
            {po.lots.length > 0 && <Button variant="secondary" onClick={() => openFile(`/production/orders/${id}/labels`).catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))}>Etiquetas QR</Button>}
            {po.status === 'RELEASED' && can('stock.edit') && <Button variant="secondary" onClick={() => setModal('issue')}>Saída de material</Button>}
            {po.status === 'RELEASED' && editable && <Button variant="secondary" onClick={() => setModal('complete')}>Concluir OP</Button>}
            {['DRAFT', 'RELEASED'].includes(po.status) && can('production.delete') && <Button variant="danger" onClick={() => setModal('cancel')}>Cancelar</Button>}
          </div>
        }
      />
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text}</Alert></div>

      <Card className="mb-6 grid grid-cols-2 gap-4 p-5 text-sm lg:grid-cols-5">
        <div><div className="text-xs text-slate-500">Estado</div><Badge tone={poTone(po.status)}>{PO_STATUS[po.status]}</Badge></div>
        <div><div className="text-xs text-slate-500">Encomenda</div><Link className="text-brand-600 hover:underline" to={`/encomendas/${po.order.id}`}>{po.order.number}</Link></div>
        <div><div className="text-xs text-slate-500">Cliente</div>{po.order.client.name}</div>
        <div><div className="text-xs text-slate-500">Prazo</div>{po.order.deadline ? formatDate(po.order.deadline) : '-'}</div>
        <div><div className="text-xs text-slate-500">Peças</div>{po.quantity}{po.lots.length > 0 && ` · ${po.lots.length} lotes`}</div>
        {po.items.map((i) => (
          <div key={i.id} className="sm:col-span-2 lg:col-span-5 text-slate-600">
            <b>{i.productModel.reference}</b> {i.productModel.name}{i.orderLine.color && ` · ${i.orderLine.color}`}: {Object.entries(i.sizeGrid).map(([s, q]) => `${s}×${q}`).join(', ')}
            {i.orderLine.details && <div className="text-xs text-slate-500">{i.orderLine.details}</div>}
          </div>
        ))}
      </Card>

      {po.status === 'DRAFT' && (
        <Card className="mb-6">
          <h3 className="px-4 pt-4 text-sm font-semibold">Necessidades de material (ficha técnica)</h3>
          <Table head={['Material', 'Necessário', 'Disponível', 'Falta']} empty={po.shortages.length === 0}>
            {po.shortages.map((s) => (
              <tr key={s.itemId}>
                <Td><span className="font-mono text-xs">{s.code}</span> {s.name}</Td>
                <Td className="text-right">{formatQty(s.required)} {s.unit}</Td>
                <Td className="text-right">{formatQty(s.available)}</Td>
                <Td className="text-right">{s.shortage ? <Badge tone="red">{formatQty(s.shortage)} {s.unit}</Badge> : <Badge tone="green">OK</Badge>}</Td>
              </tr>
            ))}
          </Table>
          {po.shortages.length === 0 && <p className="px-4 pb-4 text-sm text-amber-700">Os modelos não têm ficha técnica (BOM): não há material a reservar.</p>}
        </Card>
      )}

      {po.status !== 'DRAFT' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
            {([['Material', po.costs.material], ['Mão-de-obra', po.costs.labour], ['Externo', po.costs.external], ['Custo total', po.costs.total], ['Peças concluídas', null], ['Custo por peça', po.costs.perPiece]] as const).map(([l, v]) => (
              <Card key={l} className="p-4">
                <div className="text-xs text-slate-500">{l}</div>
                <div className="mt-1 text-lg font-semibold">{v === null ? po.costs.pieces : formatKz(v)}</div>
              </Card>
            ))}
          </div>
          <Card className="mb-6">
            <h3 className="px-4 pt-4 text-sm font-semibold">Consumo teórico vs real</h3>
            <Table head={['Material', 'Teórico', 'Reservado', 'Consumido', 'Desvio', 'Custo']} empty={po.consumption.length === 0}>
              {po.consumption.map((c) => (
                <tr key={c.itemId}>
                  <Td><span className="font-mono text-xs">{c.code}</span> {c.name}</Td>
                  <Td className="text-right">{formatQty(c.required)} {c.unit}</Td>
                  <Td className="text-right">{c.reserved ? formatQty(c.reserved) : '-'}</Td>
                  <Td className="text-right">{formatQty(c.issued)}</Td>
                  <Td className="text-right">{c.issued ? <Badge tone={c.deviationPct > 5 ? 'red' : c.deviationPct < -5 ? 'amber' : 'green'}>{c.deviationPct > 0 ? '+' : ''}{c.deviationPct}%</Badge> : '-'}</Td>
                  <Td className="text-right">{formatKz(c.issuedCost)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <h3 className="px-4 pt-4 text-sm font-semibold">Lotes por etapa <span className="font-normal text-slate-500">(concluídas / entrada · em curso)</span></h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Lote</th>
                    {po.stages.map((s) => <th key={s.id} className="px-2 py-2 font-medium whitespace-nowrap">{s.name}</th>)}
                    <th className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {po.lots.map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setLotId(l.id)}>
                      <td className="px-3 py-2 whitespace-nowrap"><div className="font-medium">{l.number}</div><div className="text-xs text-slate-500">{l.productModel.reference} · {l.size ?? '-'} · {l.quantity} pç</div></td>
                      {l.flow.map((f) => {
                        const full = f.done > 0 && f.done + f.rejected >= f.inflow && f.inflow > 0 && !f.inProgress;
                        return (
                          <td key={f.stageId} className="px-2 py-2 text-center">
                            <span className={`inline-block min-w-14 rounded px-1.5 py-0.5 text-xs ${full ? 'bg-green-100 text-green-800' : f.inProgress ? 'bg-amber-100 text-amber-800' : f.done ? 'bg-brand-50 text-brand-700' : 'text-slate-400'}`}>
                              {f.done}/{f.inflow}{f.inProgress ? ` · ${f.inProgress}` : ''}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2">{l.status === 'COMPLETED' || l.complete ? <Badge tone="green">Concluído{l.scrapped ? ` (${l.scrapped} refugo)` : ''}</Badge> : l.status === 'CANCELLED' ? <Badge tone="red">Cancelado</Badge> : <Badge>Em curso</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {lot && <LotModal lot={lot} po={po} operators={ops.data?.filter((o) => o.active) ?? []} defectTypes={defects.data?.filter((d) => d.active) ?? []} canEdit={editable && po.status === 'RELEASED'} onClose={() => setLotId(null)} reload={res.reload} />}

      {modal === 'shortage' && (
        <ConfirmModal
          title="Material insuficiente"
          message={<>
            <ul className="mb-2 list-disc pl-5">{shortErr.map((s) => <li key={s.itemId}>{s.code} {s.name}: faltam <b>{formatQty(s.shortage)} {s.unit}</b></li>)}</ul>
            Os responsáveis de stock foram notificados. Pode libertar na mesma - reserva-se o disponível e a produção avança à medida que o material chega.
          </>}
          onClose={() => setModal(null)}
          onConfirm={() => act('release', { force: true }, 'OP libertada com faltas de material.')}
        />
      )}
      {modal === 'issue' && <IssueModal po={po} onClose={() => setModal(null)} onDone={() => { setModal(null); res.reload(); setMsg({ tone: 'success', text: 'Saída de material registada.' }); }} />}
      {modal === 'complete' && <ConfirmModal title="Concluir OP" message="As reservas não consumidas são libertadas. Se for a última OP da encomenda, a encomenda passa a Pronta." onClose={() => setModal(null)} onConfirm={() => act('complete', undefined, 'OP concluída.')} />}
      {modal === 'cancel' && <ConfirmModal title="Cancelar OP" danger message="As reservas são libertadas e os lotes em aberto cancelados. O material já consumido mantém-se." onClose={() => setModal(null)} onConfirm={() => act('cancel', undefined, 'OP cancelada.')} />}
    </>
  );
}

function IssueModal({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  // Sugestão: o que falta consumir face ao teórico.
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(po.consumption.map((c) => [c.itemId, String(Math.max(0, Math.round((c.required - c.issued) * 1000) / 1000) || '')])));
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, quantity: Number(v) }));
    if (!lines.length) return setError('Indique pelo menos uma quantidade');
    try {
      await api(`/production/orders/${po.id}/issue`, { method: 'POST', body: { lines } });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={`Saída de material - ${po.number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{error}</Alert>
        <p className="text-xs text-slate-500">Consome primeiro o reservado para esta OP. Quantidades acima do teórico aparecem como desvio.</p>
        {po.consumption.map((c) => (
          <div key={c.itemId} className="grid grid-cols-[1fr_120px] items-center gap-3 text-sm">
            <div><span className="font-mono text-xs">{c.code}</span> {c.name}<div className="text-xs text-slate-500">teórico {formatQty(c.required)} · consumido {formatQty(c.issued)} · reservado {formatQty(c.reserved)} {c.unit}</div></div>
            <Input type="number" min={0} step="any" value={qty[c.itemId] ?? ''} onChange={(e) => setQty({ ...qty, [c.itemId]: e.target.value })} />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Registar saída</Button></div>
      </form>
    </Modal>
  );
}

function LotModal({ lot, po, operators, defectTypes, canEdit, onClose, reload }: {
  lot: Lot; po: PO; operators: { id: string; name: string }[]; defectTypes: { id: string; name: string }[]; canEdit: boolean; onClose: () => void; reload: () => void;
}) {
  const [start, setStart] = useState({ stageId: '', quantity: '', operatorId: '' });
  const [supplier, setSupplier] = useState<Opt | null>(null);
  const [finishing, setFinishing] = useState<Log | null>(null);
  const [error, setError] = useState('');
  const stage = po.stages.find((s) => s.id === start.stageId);
  const avail = lot.flow.find((f) => f.stageId === start.stageId)?.available ?? 0;

  const doStart = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/production/logs', { method: 'POST', body: { lotId: lot.id, stageId: start.stageId, quantity: Number(start.quantity || avail), operatorId: start.operatorId || null, supplierId: supplier?.id ?? null } });
      setStart({ stageId: '', quantity: '', operatorId: '' });
      setSupplier(null);
      setError('');
      reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const finish = async (b: FinishBody) => {
    await api(`/production/logs/${finishing!.id}/finish`, { method: 'POST', body: b });
    setFinishing(null);
    reload();
  };

  if (finishing) {
    return (
      <Modal open title={`Concluir ${finishing.stage.name} - ${lot.number}`} onClose={() => setFinishing(null)}>
        <FinishForm log={finishing} stage={po.stages.find((s) => s.id === finishing.stageId)!} stages={po.stages} defectTypes={defectTypes} onSubmit={finish} />
      </Modal>
    );
  }
  return (
    <Modal open title={`Lote ${lot.number}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600">{lot.productModel.reference} {lot.productModel.name} · tamanho {lot.size ?? '-'} · {lot.quantity} peças · concluídas {lot.finished}{lot.scrapped ? ` · refugo ${lot.scrapped}` : ''}</div>
        <Table head={['Etapa', 'Entrada', 'Feitas', 'Disp.']}>
          {po.stages.map((s) => {
            const f = lot.flow.find((x) => x.stageId === s.id)!;
            return <tr key={s.id}><Td>{s.name}</Td><Td className="text-right">{f.inflow}</Td><Td className="text-right">{f.done}{f.inProgress ? ` (+${f.inProgress})` : ''}</Td><Td className="text-right font-medium">{f.available || '-'}</Td></tr>;
          })}
        </Table>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Registos</h4>
          <ul className="space-y-1 text-sm">
            {lot.logs.length === 0 && <li className="text-slate-500">Sem registos.</li>}
            {lot.logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                <span>
                  <b>{l.stage.name}</b> · {l.operator?.name ?? l.supplier?.name ?? '-'} · {l.qtyIn} pç
                  {l.finishedAt ? <span className="text-slate-500"> → {l.qtyDone} ok{l.qtyRejected ? `, ${l.qtyRejected} rej.` : ''}{l.qtyRework ? `, ${l.qtyRework} retrab.` : ''}{l.cost ? `, ${formatKz(l.cost)}` : ''} · {formatDateTime(l.finishedAt)}</span> : <Badge tone="amber">em curso desde {formatDateTime(l.startedAt)}</Badge>}
                  {l.defects.length > 0 && <span className="text-xs text-red-600"> ({l.defects.map((d) => `${d.defectType.name} ×${d.quantity}`).join(', ')})</span>}
                </span>
                {!l.finishedAt && canEdit && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setFinishing(l)}>Concluir</Button>}
              </li>
            ))}
          </ul>
        </div>
        {canEdit && (
          <form onSubmit={doStart} className="space-y-3 rounded-lg bg-slate-50 p-3">
            <h4 className="text-sm font-semibold">Iniciar etapa</h4>
            <Alert>{error}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Etapa">
                <Select required value={start.stageId} onChange={(e) => setStart({ ...start, stageId: e.target.value })}>
                  <option value="">-</option>
                  {po.stages.map((s) => {
                    const a = lot.flow.find((f) => f.stageId === s.id)!.available;
                    return <option key={s.id} value={s.id} disabled={!a}>{s.name} ({a} disp.)</option>;
                  })}
                </Select>
              </Field>
              <Field label={`Quantidade (máx. ${avail})`}><Input type="number" min={1} max={avail} placeholder={String(avail)} value={start.quantity} onChange={(e) => setStart({ ...start, quantity: e.target.value })} /></Field>
              {stage?.type === 'EXTERNAL' ? (
                <Field label="Fornecedor (subcontratado)"><SupplierSelect value={supplier} onChange={setSupplier} /></Field>
              ) : (
                <Field label={stage?.type === 'QUALITY' ? 'Inspector (opcional)' : 'Operador'}>
                  <Select required={stage?.type === 'INTERNAL'} value={start.operatorId} onChange={(e) => setStart({ ...start, operatorId: e.target.value })}>
                    <option value="">-</option>
                    {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            {stage && <p className="text-xs text-slate-500">{STAGE_TYPE[stage.type]}{stage.type === 'EXTERNAL' && ' - iniciar = envio; concluir = retorno com custo.'}</p>}
            <Button type="submit" disabled={!start.stageId}>Iniciar</Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
