import { formatDateTime } from '@ivamarg/shared';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type N = { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

export function NotificationBell({ align = 'left' }: { align?: 'left' | 'right' | 'side' }) {
  const [data, setData] = useState<{ items: N[]; unread: number }>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const load = () => api<typeof data>('/notifications').then(setData).catch(() => {});

  useEffect(() => {
    load();
    // ponytail: polling a cada minuto; trocar por SSE/websocket se for preciso tempo real.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const openItem = async (n: N) => {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' });
    setOpen(false);
    load();
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative cursor-pointer rounded-lg p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white" aria-label="Notificações">
        <Bell size={20} aria-hidden />
        {data.unread > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className={`absolute ${{ left: 'left-0 mt-2', right: 'right-0 mt-2', side: 'bottom-0 left-full ml-2' }[align]} z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm font-medium">
            Notificações
            {data.unread > 0 && <button className="text-xs text-brand-600" onClick={() => api('/notifications/read-all', { method: 'POST' }).then(load)}>Marcar todas como lidas</button>}
          </div>
          <ul className="max-h-96 overflow-auto">
            {data.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Sem notificações.</li>}
            {data.items.map((n) => (
              <li key={n.id}>
                <button onClick={() => openItem(n)} className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${n.readAt ? 'text-slate-500' : ''}`}>
                  <div className={n.readAt ? '' : 'font-medium'}>{n.title}</div>
                  {n.body && <div className="text-xs text-slate-500">{n.body}</div>}
                  <div className="mt-1 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</div>
                </button>
              </li>
            ))}
          </ul>
          <EmailPref />
        </div>
      )}
    </div>
  );
}

function EmailPref() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { api<{ notifyEmail: boolean }>('/users/me/preferences').then((r) => setOn(r.notifyEmail)).catch(() => {}); }, []);
  if (on === null) return null;
  return (
    <label className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
      <input type="checkbox" className="accent-brand-600" checked={on} onChange={(e) => { setOn(e.target.checked); api('/users/me/preferences', { method: 'PATCH', body: { notifyEmail: e.target.checked } }).catch(() => setOn(!e.target.checked)); }} />
      Receber também por email
    </label>
  );
}
