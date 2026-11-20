import { CHANNELS, formatDateTime, type Channel } from '@ivamarg/shared';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Card, Select } from '../../components/ui';
import { api, toQuery } from '../../lib/api';
import { errMsg, formatPhone } from '../../lib/format';
import { useApi, type Page } from '../../lib/useApi';
import { ConversationView } from './InboxPage';

type Row = { id: string; channel: Channel; externalId: string; lastMessageAt: string; unread: number };

/** Conversas do cliente (todas os canais) + iniciar conversa por WhatsApp/SMS/email. */
export function ClientConversations({ clientId, phones, email }: { clientId: string; phones: string[]; email: string | null }) {
  const { can } = useAuth();
  const list = useApi<Page<Row>>(can('communication.view') ? `/communication/conversations${toQuery({ clientId, pageSize: 50 })}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  if (!can('communication.view')) return <Alert tone="info">Sem permissão para ver conversas.</Alert>;
  const options = [...phones.flatMap((p) => [`WHATSAPP|${p}`, `SMS|${p}`]), ...(email ? [`EMAIL|${email}`] : [])];
  const start = async () => {
    const [channel, value] = (to || options[0]).split('|');
    try {
      const c = await api<{ id: string }>('/communication/conversations', { method: 'POST', body: { clientId, channel, to: value } });
      setOpen(c.id);
      list.reload();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <div className="space-y-4">
      <Alert>{error}</Alert>
      <Card className="divide-y divide-slate-100">
        {list.data?.items.length === 0 && <p className="p-4 text-sm text-slate-500">Sem conversas.</p>}
        {list.data?.items.map((c) => (
          <button key={c.id} className={`flex w-full justify-between px-4 py-3 text-left text-sm hover:bg-slate-50 ${open === c.id ? 'bg-brand-50' : ''}`} onClick={() => setOpen(c.id)}>
            <span>{CHANNELS[c.channel]} · {c.channel === 'EMAIL' ? c.externalId : formatPhone(c.externalId)}</span>
            <span className="text-xs text-slate-500">{c.unread > 0 && `${c.unread} nova(s) · `}{formatDateTime(c.lastMessageAt)}</span>
          </button>
        ))}
        {can('communication.create') && options.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3">
            <Select className="w-64" value={to} onChange={(e) => setTo(e.target.value)}>
              {options.map((o) => { const [ch, v] = o.split('|'); return <option key={o} value={o}>{CHANNELS[ch as Channel]} · {ch === 'EMAIL' ? v : formatPhone(v)}</option>; })}
            </Select>
            <Button variant="secondary" onClick={start}>Iniciar conversa</Button>
          </div>
        )}
      </Card>
      {open && <ConversationView id={open} onBack={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}
