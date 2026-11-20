import { DOCUMENT_MIME, formatDate, formatDateTime, LINKABLE_ENTITIES, MAX_UPLOAD_MB } from '@ivamarg/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { api, toQuery, upload } from '../../lib/api';
import { errMsg, toDateInput } from '../../lib/format';
import { useApi, type Page } from '../../lib/useApi';

export type Doc = {
  id: string; title: string; description: string | null; tags: string[]; issuedAt: string | null; expiresAt: string | null; currentVersion: number; createdAt: string; createdById: string | null;
  category: { id: string; name: string }; folder: { id: string; name: string } | null;
  links: { entity: keyof typeof LINKABLE_ENTITIES; entityId: string }[];
  versions: { id: string; version: number; filename: string; mime: string; size: number; createdAt: string }[];
};
type Cat = { id: string; name: string; roleIds: string[]; active: boolean };

const ACCEPT = DOCUMENT_MIME.join(',');
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** Estado da validade: vermelho expirado, âmbar < 30 dias. */
export function ExpiryBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-slate-400">-</span>;
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86400000);
  if (days < 0) return <Badge tone="red">Expirado {formatDate(date)}</Badge>;
  if (days <= 30) return <Badge tone="amber">{formatDate(date)} ({days} d)</Badge>;
  return <span>{formatDate(date)}</span>;
}

export function DocumentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', categoryId: '', expiring: '' });
  const list = useApi<Page<Doc>>(`/documents${toQuery({ page, ...f })}`);
  const cats = useApi<Cat[]>('/documents/categories');
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get('id'));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title="Documentos" actions={can('documents.create') && <Button onClick={() => setUploading(true)}>Carregar documento</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Título, descrição ou tag…" value={f.search} onChange={set('search')} />
        <Select value={f.categoryId} onChange={set('categoryId')}>
          <option value="">Todas as categorias</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={f.expiring} onChange={set('expiring')}>
          <option value="">Qualquer validade</option>
          <option value="0">Expirados</option>
          <option value="30">Expiram em 30 dias (ou expirados)</option>
          <option value="90">Expiram em 90 dias (ou expirados)</option>
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <DocTable docs={list.data?.items} onOpen={setOpen} />
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {uploading && <UploadModal categories={cats.data ?? []} onClose={() => setUploading(false)} onDone={(d) => { setUploading(false); list.reload(); setOpen(d.id); }} />}
      {open && <DocModal id={open} categories={cats.data ?? []} onClose={() => { setOpen(null); setParams({}, { replace: true }); }} onChanged={list.reload} />}
    </>
  );
}

function DocTable({ docs, onOpen }: { docs?: Doc[]; onOpen: (id: string) => void }) {
  return (
    <Table head={['Documento', 'Categoria', 'Ligado a', 'Emissão', 'Validade', 'Versão']} empty={docs?.length === 0}>
      {docs?.map((d) => (
        <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(d.id)}>
          <Td>
            <div className="font-medium">{d.title}</div>
            <div className="text-xs text-slate-500">{d.versions[0]?.filename}{d.tags.map((t) => <span key={t} className="ml-1"><Badge>{t}</Badge></span>)}</div>
          </Td>
          <Td>{d.category.name}</Td>
          <Td className="text-slate-600">{d.links.map((l) => LINKABLE_ENTITIES[l.entity]).join(', ') || '-'}</Td>
          <Td>{d.issuedAt ? formatDate(d.issuedAt) : '-'}</Td>
          <Td><ExpiryBadge date={d.expiresAt} /></Td>
          <Td className="text-center">v{d.currentVersion}</Td>
        </tr>
      ))}
    </Table>
  );
}

/** Painel para fichas (cliente, encomenda, contrato…): documentos ligados + carregar já ligado. */
export function DocumentsPanel({ entity, entityId }: { entity: keyof typeof LINKABLE_ENTITIES; entityId: string }) {
  const { can } = useAuth();
  const list = useApi<Page<Doc>>(`/documents${toQuery({ entity, entityId, pageSize: 50 })}`);
  const cats = useApi<Cat[]>('/documents/categories');
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!can('documents.view')) return <Alert tone="info">Sem permissão para ver documentos.</Alert>;
  return (
    <Card>
      {can('documents.create') && <div className="flex justify-end p-3"><Button variant="secondary" onClick={() => setUploading(true)}>Carregar documento</Button></div>}
      <DocTable docs={list.data?.items} onOpen={setOpen} />
      {uploading && <UploadModal categories={cats.data ?? []} link={{ entity, entityId }} onClose={() => setUploading(false)} onDone={() => { setUploading(false); list.reload(); }} />}
      {open && <DocModal id={open} categories={cats.data ?? []} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </Card>
  );
}

function MetaFields({ f, setF, categories }: { f: Meta; setF: (m: Meta) => void; categories: Cat[] }) {
  return (
    <>
      <Field label="Título"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Categoria">
        <Select required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">-</option>
          {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Data de emissão"><Input type="date" value={f.issuedAt} onChange={(e) => setF({ ...f, issuedAt: e.target.value })} /></Field>
        <Field label="Data de validade"><Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
      </div>
      <Field label="Tags - separar por vírgula"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      <Field label="Descrição"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    </>
  );
}
type Meta = { title: string; categoryId: string; issuedAt: string; expiresAt: string; tags: string; description: string };
const metaBody = (f: Meta) => ({ ...f, issuedAt: f.issuedAt || null, expiresAt: f.expiresAt || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) });

function UploadModal({ categories, link, onClose, onDone }: { categories: Cat[]; link?: { entity: string; entityId: string }; onClose: () => void; onDone: (d: Doc) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState<Meta>({ title: '', categoryId: '', issuedAt: '', expiresAt: '', tags: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (fl: File) => {
    if (fl.size > MAX_UPLOAD_MB * 1048576) return setError(`Ficheiro acima de ${MAX_UPLOAD_MB} MB`);
    setError('');
    setFile(fl);
    if (!f.title) setF({ ...f, title: fl.name.replace(/\.[^.]+$/, '') });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError('Escolha o ficheiro');
    setBusy(true);
    try {
      onDone(await upload<Doc>('/documents', file, { ...metaBody(f), links: link ? [link] : [] }));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Carregar documento" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label={`Ficheiro (PDF, imagem, Word, Excel - máx. ${MAX_UPLOAD_MB} MB)`}>
          <input type="file" accept={ACCEPT} className="text-sm" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </Field>
        <MetaFields f={f} setF={setF} categories={categories} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? 'A enviar…' : 'Carregar'}</Button></div>
      </form>
    </Modal>
  );
}

function DocModal({ id, categories, onClose, onChanged }: { id: string; categories: Cat[]; onClose: () => void; onChanged: () => void }) {
  const { can, user } = useAuth();
  const res = useApi<Doc>(`/documents/${id}`);
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [editing, setEditing] = useState<Meta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const d = res.data;
  const canEdit = !!d && (can('documents.edit') || (d.createdById === user?.id && can('documents.create')));

  useEffect(() => {
    if (!d) return;
    const v = d.versions[0];
    if (v && (v.mime === 'application/pdf' || v.mime.startsWith('image/'))) {
      api<{ url: string; mime: string }>(`/documents/${id}/url`).then(setPreview).catch(() => setPreview(null));
    } else setPreview(null);
  }, [d, id]);

  const download = async (version: number) => {
    try {
      const r = await api<{ url: string }>(`/documents/${id}/url?version=${version}&download=1`);
      window.location.href = r.url;
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  const newVersion = async (file: File) => {
    try {
      await upload(`/documents/${id}/versions`, file);
      setMsg({ tone: 'success', text: 'Nova versão carregada.' });
      res.reload();
      onChanged();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  const saveMeta = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/documents/${id}`, { method: 'PATCH', body: metaBody(editing!) });
      setEditing(null);
      res.reload();
      onChanged();
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    }
  };

  return (
    <Modal open title={d?.title ?? 'Documento'} onClose={onClose}>
      {!d ? <div className="text-slate-500">{res.error ?? 'A carregar…'}</div> : editing ? (
        <form onSubmit={saveMeta} className="space-y-4">
          <MetaFields f={editing} setF={setEditing} categories={categories} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
        </form>
      ) : (
        <div className="space-y-4">
          <Alert tone={msg?.tone}>{msg?.text}</Alert>
          {preview && (preview.mime.startsWith('image/')
            ? <img src={preview.url} alt={d.title} className="max-h-80 w-full rounded border border-slate-200 object-contain" />
            : <iframe src={preview.url} title={d.title} className="h-80 w-full rounded border border-slate-200" />)}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Categoria</div>{d.category.name}</div>
            <div><div className="text-xs text-slate-500">Validade</div><ExpiryBadge date={d.expiresAt} /></div>
            <div><div className="text-xs text-slate-500">Emissão</div>{d.issuedAt ? formatDate(d.issuedAt) : '-'}</div>
            <div><div className="text-xs text-slate-500">Ligado a</div>{d.links.map((l) => LINKABLE_ENTITIES[l.entity]).join(', ') || '-'}</div>
            {d.description && <div className="col-span-2"><div className="text-xs text-slate-500">Descrição</div>{d.description}</div>}
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Versões</h4>
            <ul className="divide-y divide-slate-100 text-sm">
              {d.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-1.5">
                  <span>v{v.version} · {v.filename} · {kb(v.size)} · {formatDateTime(v.createdAt)}</span>
                  <button className="text-brand-600 hover:underline" onClick={() => download(v.version)}>Descarregar</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              {canEdit && (
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Nova versão<input type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && newVersion(e.target.files[0])} />
                </label>
              )}
              {canEdit && <Button variant="secondary" onClick={() => setEditing({ title: d.title, categoryId: d.category.id, issuedAt: toDateInput(d.issuedAt), expiresAt: toDateInput(d.expiresAt), tags: d.tags.join(', '), description: d.description ?? '' })}>Editar</Button>}
            </div>
            {can('documents.delete') && <Button variant="danger" onClick={() => setDeleting(true)}>Eliminar</Button>}
          </div>
        </div>
      )}
      {deleting && <ConfirmModal title="Eliminar documento" danger message="O documento deixa de estar disponível. O registo fica na auditoria." onClose={() => setDeleting(false)} onConfirm={async () => { await api(`/documents/${id}`, { method: 'DELETE' }); onChanged(); onClose(); }} />}
    </Modal>
  );
}
