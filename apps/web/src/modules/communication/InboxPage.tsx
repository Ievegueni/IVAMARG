import { CHANNELS, CONVERSATION_STATUS, formatDateTime, type Channel } from '@ivamarg/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatPhone } from '../../lib/format';
import { useUserOptions } from '../../lib/options';
import { useApi, type Page } from '../../lib/useApi';
import { startCall } from './calls';

type ConvRow = {
  id: string; channel: Channel; externalId: string; contactName: string | null; clientId: string | null; clientName: string | null; status: keyof typeof CONVERSATION_STATUS;
  unread: number; lastMessageAt: string; assignee: { id: string; name: string } | null; messages: { body: string | null; direction: string; type: string }[];
};
type Msg = { id: string; direction: 'IN' | 'OUT' | 'NOTE'; type: string; body: string | null; mediaId: string | null; mediaUrl: string | null; status: string; error: string | null; createdAt: string; userName: string | null };
type Conv = Omit<ConvRow, 'messages'> & {
  client: { id: string; name: string } | null; messages: Msg[]; sandbox: boolean; callConsentAt: string | null;
  policy: { freeform: boolean; template: boolean; blocked: boolean; closesAt: string | null };
};
type Template = { id: string; name: string; channels: Channel[]; body: string; waTemplateName: string | null; active: boolean };

const CH_TONE: Record<Channel, string> = { WHATSAPP: 'bg-green-100 text-green-800', MESSENGER: 'bg-blue-100 text-blue-800', INSTAGRAM: 'bg-pink-100 text-pink-800', EMAIL: 'bg-slate-100 text-slate-700', SMS: 'bg-amber-100 text-amber-800' };
const ChannelTag = ({ c }: { c: Channel }) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CH_TONE[c]}`}>{CHANNELS[c]}</span>;
const STATUS_LABEL: Record<string, string> = { QUEUED: 'na fila', SENT: 'enviada', DELIVERED: 'entregue', READ: 'lida', FAILED: 'falhou', SIMULATED: 'simulada (sandbox)' };
const contact = (c: ConvRow) => c.contactName ?? (c.channel === 'WHATSAPP' || c.channel === 'SMS' ? formatPhone(c.externalId) : c.externalId);

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState({ channel: '', status: 'OPEN', assigneeId: '', search: '' });
  const list = useApi<Page<ConvRow>>(`/communication/conversations${toQuery({ ...f, pageSize: 50 })}`);
  const selected = params.get('c');
  const users = useUserOptions();
  const { can } = useAuth();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  // ponytail: actualização por polling (20 s); websockets se o volume justificar.
  useEffect(() => {
    const t = setInterval(list.reload, 20_000);
    return () => clearInterval(t);
  }, [list.reload]);

  return (
    <>
      <PageHeader title="Caixa de entrada" />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className={selected ? 'hidden lg:block' : ''}>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Input className="col-span-2" placeholder="Nome ou contacto…" value={f.search} onChange={set('search')} />
            <Select value={f.channel} onChange={set('channel')}>
              <option value="">Todos os canais</option>
              {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={f.status} onChange={set('status')}>
              <option value="">Todos</option>
              {Object.entries(CONVERSATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {can('communication.viewAll') && (
              <Select className="col-span-2" value={f.assigneeId} onChange={set('assigneeId')}>
                <option value="">Todos os responsáveis</option>
                <option value="none">Sem responsável</option>
                {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
          </div>
          <Alert>{list.error}</Alert>
          <Card className="divide-y divide-slate-100 overflow-hidden">
            {list.data?.items.length === 0 && <p className="p-4 text-sm text-slate-500">Sem conversas.</p>}
            {list.data?.items.map((c) => (
              <button key={c.id} onClick={() => setParams({ c: c.id })} className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${selected === c.id ? 'bg-brand-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.clientName ?? contact(c)}</span>
                  <ChannelTag c={c.channel} />
                </div>
                <div className="mt-0.5 flex justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">{c.messages[0]?.direction === 'OUT' && 'Eu: '}{c.messages[0]?.body ?? '-'}</span>
                  <span className="shrink-0">{c.unread > 0 ? <Badge tone="green">{c.unread}</Badge> : formatDateTime(c.lastMessageAt).split(' ')[0]}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">{c.assignee?.name ?? 'Sem responsável'} · {CONVERSATION_STATUS[c.status]}</div>
              </button>
            ))}
          </Card>
        </div>
        {selected ? <ConversationView id={selected} onBack={() => setParams({})} onChanged={list.reload} /> : <Card className="hidden p-8 text-center text-slate-500 lg:block">Seleccione uma conversa.</Card>}
      </div>
    </>
  );
}

export function ConversationView({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const res = useApi<Conv>(`/communication/conversations/${id}`);
  const templates = useApi<Template[]>('/communication/templates');
  const users = useUserOptions();
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [note, setNote] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const c = res.data;

  useEffect(() => { bottom.current?.scrollIntoView(); }, [c?.messages.length]);
  useEffect(() => {
    const t = setInterval(res.reload, 10_000);
    return () => clearInterval(t);
  }, [res.reload]);
  if (res.error) return <Alert>{res.error}</Alert>;
  if (!c) return <Card className="p-6 text-slate-500">A carregar…</Card>;

  const usable = templates.data?.filter((t) => t.active && t.channels.includes(c.channel)) ?? [];
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/communication/conversations/${id}/messages`, { method: 'POST', body: note ? { body: text, note: true } : templateId ? { templateId } : { body: text } });
      setText('');
      setTemplateId('');
      res.reload();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const update = async (body: object) => {
    await api(`/communication/conversations/${id}`, { method: 'PATCH', body }).catch((e) => setError(errMsg(e)));
    res.reload();
    onChanged();
  };
  const canSend = can('communication.create');
  const mustTemplate = !c.policy.freeform && !note;

  return (
    <Card className="flex h-[75vh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <button className="text-slate-500 lg:hidden" onClick={onBack} aria-label="Voltar">←</button>
        <div className="mr-auto">
          <div className="font-semibold">{c.client ? <Link to={`/clientes/${c.client.id}`} className="hover:underline">{c.client.name}</Link> : contact(c)}</div>
          <div className="text-xs text-slate-500"><ChannelTag c={c.channel} /> {contact(c)}{c.sandbox && c.channel !== 'EMAIL' && <span className="ml-2 text-amber-700">modo sandbox</span>}</div>
        </div>
        {c.channel === 'WHATSAPP' && can('communication.create') && (
          <CallControls conv={c} reload={res.reload} onError={setError} />
        )}
        {can('communication.edit') && (
          <>
            <Select className="w-40 py-1 text-xs" value={c.assignee?.id ?? ''} onChange={(e) => update({ assigneeId: e.target.value || null })}>
              <option value="">Sem responsável</option>
              {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Select className="w-32 py-1 text-xs" value={c.status} onChange={(e) => update({ status: e.target.value })}>
              {Object.entries(CONVERSATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
        {c.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === 'IN' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.direction === 'IN' ? 'bg-white' : m.direction === 'NOTE' ? 'border border-amber-200 bg-amber-50' : 'bg-brand-600 text-white'}`}>
              {m.direction === 'NOTE' && <div className="mb-0.5 text-[11px] font-medium text-amber-700">Nota interna</div>}
              {m.mediaId && <a className="underline" href={`/api/communication/messages/${m.id}/media`} target="_blank">[{m.type.toLowerCase()}]</a>}
              {m.mediaUrl && <a className="underline" href={m.mediaUrl} target="_blank">[anexo]</a>}
              <div className="whitespace-pre-line">{m.body}</div>
              <div className={`mt-1 text-[10px] ${m.direction === 'OUT' ? 'text-white/70' : 'text-slate-400'}`}>
                {formatDateTime(m.createdAt)}{m.userName && ` · ${m.userName}`}{m.direction === 'OUT' && ` · ${STATUS_LABEL[m.status] ?? m.status}`}{m.type === 'TEMPLATE' && ' · template'}
              </div>
              {m.error && <div className="mt-1 text-[11px] text-red-200">{m.error}</div>}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {canSend && (
        <form onSubmit={send} className="space-y-2 border-t border-slate-100 p-3">
          <Alert>{error}</Alert>
          {c.policy.blocked && !note && <Alert tone="info">Janela de 24h fechada: o {CHANNELS[c.channel]} só permite responder até 24h após a última mensagem do cliente. Pode deixar uma nota interna.</Alert>}
          {mustTemplate && !c.policy.blocked && <Alert tone="info">Fora da janela de 24h: só é possível enviar um template aprovado.</Alert>}
          {c.policy.freeform && c.policy.closesAt && <p className="text-[11px] text-slate-500">Janela aberta até {formatDateTime(c.policy.closesAt)}</p>}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} /> Nota interna</label>
            {!note && usable.length > 0 && !c.policy.blocked && (
              <Select className="w-56 py-1 text-xs" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">{mustTemplate ? '- escolher template -' : 'Texto livre'}</option>
                {usable.map((t) => <option key={t.id} value={t.id}>{t.name}{c.channel === 'WHATSAPP' && !t.waTemplateName ? ' (não aprovado)' : ''}</option>)}
              </Select>
            )}
          </div>
          {templateId ? (
            <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">{usable.find((t) => t.id === templateId)?.body}</p>
          ) : (
            <Textarea rows={2} disabled={!note && (c.policy.blocked || mustTemplate)} placeholder={note ? 'Nota visível só para a equipa…' : 'Escrever mensagem…'} value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <div className="flex justify-end"><Button type="submit" disabled={!templateId && !text.trim()}>{note ? 'Guardar nota' : 'Enviar'}</Button></div>
        </form>
      )}
    </Card>
  );
}

/** Ligar ao cliente (só com consentimento registado) e gerir o consentimento. */
function CallControls({ conv, reload, onError }: { conv: Conv; reload: () => void; onError: (m: string) => void }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 text-xs">
      {can('communication.edit') && (
        <label className="flex items-center gap-1" title="O cliente autorizou chamadas da empresa">
          <input type="checkbox" checked={!!conv.callConsentAt} onChange={(e) => api(`/communication/conversations/${conv.id}/call-consent`, { method: 'POST', body: { granted: e.target.checked } }).then(reload).catch((x) => onError(errMsg(x)))} />
          consente chamadas
        </label>
      )}
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!conv.callConsentAt || busy}
        onClick={async () => { setBusy(true); try { await startCall(conv.id, conv.sandbox); } catch (x) { onError(errMsg(x)); } finally { setBusy(false); } }}>
        📞 Ligar
      </Button>
    </div>
  );
}
