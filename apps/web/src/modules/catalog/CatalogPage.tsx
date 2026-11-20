import { formatKz } from '@ivamarg/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ItemSelect, itemOpt, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useAppSettings, useStages } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';

type Row = { id: string; reference: string; name: string; basePrice: number; active: boolean; photos: string[]; _count: { bom: number } };
type Model = {
  id: string;
  reference: string;
  name: string;
  basePrice: number;
  description: string | null;
  photos: string[];
  active: boolean;
  bom: { stockItemId: string; size: string | null; consumption: string; stockItem: { id: string; code: string; name: string; unit: string; avgCost: string } }[];
  standardTimes: { stageId: string; minutesPerPiece: string }[];
};

export function CatalogPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const list = useApi<Page<Row>>(`/catalog${toQuery({ page, search })}`);
  return (
    <>
      <PageHeader title="Catálogo de modelos" actions={can('production.create') && <Link to="/catalogo/novo"><Button>Novo modelo</Button></Link>} />
      <Input className="mb-4 max-w-sm" placeholder="Referência ou nome…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['', 'Referência', 'Modelo', 'Preço base', 'Ficha técnica']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((m) => (
            <tr key={m.id} className={`cursor-pointer hover:bg-slate-50 ${m.active ? '' : 'opacity-50'}`} onClick={() => navigate(`/catalogo/${m.id}`)}>
              <Td className="w-14">{m.photos[0] ? <img src={m.photos[0]} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-slate-100" />}</Td>
              <Td className="font-mono text-xs">{m.reference}</Td>
              <Td className="font-medium">{m.name}</Td>
              <Td>{formatKz(m.basePrice)}</Td>
              <Td>{m._count.bom ? `${m._count.bom} linha(s) de material` : <Badge tone="amber">Sem BOM</Badge>}</Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
    </>
  );
}

type BomRow = { item: Opt | null; avgCost: number; size: string; consumption: string };

export function ModelEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const res = useApi<Model>(id ? `/catalog/${id}` : null);
  const sizes = useAppSettings().data?.orderSizes ?? [];
  const stages = useStages();
  const [f, setF] = useState({ reference: '', name: '', basePrice: 0, description: '', active: true });
  const [photos, setPhotos] = useState<string[]>([]);
  const [bom, setBom] = useState<BomRow[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const m = res.data;

  useEffect(() => {
    if (!m) return;
    setF({ reference: m.reference, name: m.name, basePrice: m.basePrice, description: m.description ?? '', active: m.active });
    setPhotos(m.photos);
    setBom(m.bom.map((b) => ({ item: itemOpt(b.stockItem), avgCost: Number(b.stockItem.avgCost), size: b.size ?? '', consumption: String(Number(b.consumption)) })));
    setTimes(Object.fromEntries(m.standardTimes.map((t) => [t.stageId, String(Number(t.minutesPerPiece))])));
  }, [m]);

  if (res.error) return <Alert>{res.error}</Alert>;
  if (id && !m) return <div className="text-slate-500">A carregar…</div>;
  const editable = can(id ? 'production.edit' : 'production.create');
  const setRow = (i: number, d: Partial<BomRow>) => setBom(bom.map((b, j) => (j === i ? { ...b, ...d } : b)));
  // Custo de material estimado por peça (tamanho genérico), ao custo médio actual.
  const estCost = Math.round(bom.filter((b) => !b.size).reduce((s, b) => s + Number(b.consumption || 0) * b.avgCost, 0));

  const addPhoto = (file: File) => {
    if (file.size > 500 * 1024) return setMsg({ tone: 'error', text: 'Foto demasiado grande (máx. 500 KB).' });
    const r = new FileReader();
    r.onload = () => setPhotos((p) => [...p, String(r.result)].slice(0, 4));
    r.readAsDataURL(file);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (bom.some((b) => !b.item)) return setMsg({ tone: 'error', text: 'Seleccione o material em todas as linhas da BOM' });
    const body = {
      ...f,
      photos,
      bom: bom.map((b) => ({ stockItemId: b.item!.id, size: b.size || null, consumption: b.consumption })),
      standardTimes: Object.entries(times).filter(([, v]) => Number(v) > 0).map(([stageId, v]) => ({ stageId, minutesPerPiece: v })),
    };
    try {
      if (id) {
        await api(`/catalog/${id}`, { method: 'PUT', body });
        setMsg({ tone: 'success', text: 'Modelo guardado.' });
        res.reload();
      } else navigate(`/catalogo/${(await api<Model>('/catalog', { method: 'POST', body })).id}`, { replace: true });
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    }
  };

  return (
    <>
      <PageHeader title={m ? `${m.reference} - ${m.name}` : 'Novo modelo'} />
      <form onSubmit={save} className="space-y-6">
        <Alert tone={msg?.tone}>{msg?.text}</Alert>
        <Card className="grid gap-4 p-5 sm:grid-cols-[160px_1fr_160px]">
          <Field label="Referência"><Input required disabled={!editable} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Nome"><Input required disabled={!editable} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Preço base (Kz)"><Input type="number" min={0} step={1} disabled={!editable} value={f.basePrice} onChange={(e) => setF({ ...f, basePrice: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-3"><Field label="Descrição"><Textarea disabled={!editable} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={!editable} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo</label>
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Fotos</h3>
          <p className="mb-3 text-xs text-slate-500">Até 4 imagens (máx. 500 KB cada).</p>
          <div className="flex flex-wrap gap-3">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                <img src={p} alt="" className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
                {editable && <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 rounded-full bg-red-600 px-1.5 text-xs text-white" aria-label="Remover foto">✕</button>}
              </div>
            ))}
            {editable && photos.length < 4 && (
              <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand-600">
                + Foto
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
              </label>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Ficha técnica (BOM) - consumo por peça</h3>
            <span className="text-xs text-slate-500">Custo de material estimado/peça: <b>{formatKz(estCost)}</b> (linhas "todos os tamanhos", custo médio actual)</span>
          </div>
          <p className="mb-3 text-xs text-slate-500">Linha com tamanho vazio vale para todos; linha com tamanho específico substitui-a nesse tamanho.</p>
          <div className="space-y-2">
            {bom.map((b, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
                <Field label="Material"><ItemSelect value={b.item} onChange={(o) => setRow(i, { item: o, avgCost: o ? Number(o.raw.avgCost) : 0 })} disabled={!editable} /></Field>
                <Field label="Tamanho">
                  <Select disabled={!editable} value={b.size} onChange={(e) => setRow(i, { size: e.target.value })}>
                    <option value="">Todos</option>
                    {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label={`Consumo${b.item?.hint ? ` (${b.item.hint})` : ''}`}><Input type="number" min={0.001} step="any" required disabled={!editable} value={b.consumption} onChange={(e) => setRow(i, { consumption: e.target.value })} /></Field>
                {editable && <Button type="button" variant="secondary" onClick={() => setBom(bom.filter((_, j) => j !== i))}>✕</Button>}
              </div>
            ))}
          </div>
          {editable && <Button type="button" variant="secondary" className="mt-3" onClick={() => setBom([...bom, { item: null, avgCost: 0, size: '', consumption: '' }])}>+ Material</Button>}
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Tempo padrão por etapa (opcional)</h3>
          <p className="mb-3 text-xs text-slate-500">Minutos por peça - usado no cálculo de eficiência.</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stages.data?.filter((s) => s.active && s.type !== 'EXTERNAL').map((s) => (
              <Field key={s.id} label={s.name}><Input type="number" min={0} step="any" disabled={!editable} value={times[s.id] ?? ''} onChange={(e) => setTimes({ ...times, [s.id]: e.target.value })} /></Field>
            ))}
          </div>
        </Card>
        {editable && <div className="flex justify-end"><Button type="submit">{id ? 'Guardar' : 'Criar modelo'}</Button></div>}
      </form>
    </>
  );
}
