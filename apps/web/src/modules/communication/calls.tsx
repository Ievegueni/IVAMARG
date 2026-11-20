import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../app/auth';
import { Button, ConfirmModal } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, formatPhone } from '../../lib/format';

// Chamadas WhatsApp no browser (WebRTC). A Meta envia o SDP da chamada; aqui gera-se a resposta (ou a oferta,
// nas efectuadas) e a API reencaminha. Em sandbox não há SDP: só a sinalização e o registo.

type Call = { id: string; direction: 'IN' | 'OUT'; status: string; offerSdp: string | null; answerSdp: string | null; answeredAt: string | null; conversation?: { id: string; externalId: string; contactName: string | null } };

let pc: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
const audio = typeof Audio !== 'undefined' ? new Audio() : null;

async function newPeer() {
  hangupMedia();
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  mic.getTracks().forEach((t) => pc!.addTrack(t, mic!));
  pc.ontrack = (e) => { if (audio) { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); } };
  return pc;
}
/** Espera o fim da recolha de candidatos ICE (a Meta quer o SDP completo, sem trickle). */
const gathered = (p: RTCPeerConnection) =>
  p.iceGatheringState === 'complete' ? Promise.resolve() : new Promise<void>((r) => { p.onicegatheringstatechange = () => p.iceGatheringState === 'complete' && r(); setTimeout(r, 3000); });
export function hangupMedia() {
  pc?.close();
  mic?.getTracks().forEach((t) => t.stop());
  pc = null;
  mic = null;
}

async function answerSdp(offer: string) {
  const p = await newPeer();
  await p.setRemoteDescription({ type: 'offer', sdp: offer });
  await p.setLocalDescription(await p.createAnswer());
  await gathered(p);
  return p.localDescription!.sdp;
}

/** Inicia chamada efectuada; devolve o id. Em modo real fica à espera do SDP de resposta do cliente. */
export async function startCall(conversationId: string, sandbox: boolean) {
  let sdp = '';
  if (!sandbox) {
    const p = await newPeer();
    await p.setLocalDescription(await p.createOffer());
    await gathered(p);
    sdp = p.localDescription!.sdp;
  }
  const call = await api<Call>(`/communication/conversations/${conversationId}/call`, { method: 'POST', body: { sdp } });
  if (!sandbox) {
    for (let i = 0; i < 60 && pc; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const c = await api<Call>(`/communication/calls/${call.id}`);
      if (c.answerSdp) { await pc.setRemoteDescription({ type: 'answer', sdp: c.answerSdp }); break; }
      if (['ENDED', 'MISSED', 'REJECTED', 'FAILED'].includes(c.status)) break;
    }
  }
  return call.id;
}

const elapsed = (from: string | null) => {
  if (!from) return '0:00';
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Barra global: chamada a tocar (atender/rejeitar) ou em curso (terminar). */
export function CallBar() {
  const { can } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [ending, setEnding] = useState<Call | null>(null);
  const [error, setError] = useState('');
  const [, tick] = useState(0);
  const enabled = can('communication.view');
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!enabled) return;
    const load = () => api<Call[]>('/communication/calls/active').then(setCalls).catch(() => {});
    load();
    timer.current = setInterval(() => { load(); tick((x) => x + 1); }, 4000);
    return () => clearInterval(timer.current);
  }, [enabled]);
  if (!calls.length) return null;
  const c = calls[0];
  const who = c.conversation?.contactName ?? (c.conversation ? formatPhone(c.conversation.externalId) : '');

  const accept = async () => {
    try {
      const sdp = c.offerSdp ? await answerSdp(c.offerSdp) : '';
      await api(`/communication/calls/${c.id}/accept`, { method: 'POST', body: { sdp } });
      setCalls([{ ...c, status: 'ACCEPTED', answeredAt: new Date().toISOString() }]);
    } catch (e) {
      hangupMedia();
      setError(errMsg(e));
    }
  };
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-green-700 px-4 py-2 text-sm text-white shadow-lg" role="alert">
      <span>📞 {c.status === 'RINGING' ? `Chamada WhatsApp de ${who}` : `Em chamada com ${who} · ${elapsed(c.answeredAt)}`}{!c.offerSdp && !c.answerSdp && ' (sandbox - sem áudio)'}</span>
      {c.status === 'RINGING' && c.direction === 'IN' ? (
        <>
          <Button variant="secondary" className="px-3 py-1 font-semibold" onClick={accept}>Atender</Button>
          <Button variant="danger" className="px-3 py-1" onClick={() => api(`/communication/calls/${c.id}/reject`, { method: 'POST' }).then(() => setCalls([])).catch((e) => setError(errMsg(e)))}>Rejeitar</Button>
        </>
      ) : (
        <Button variant="danger" className="px-3 py-1" onClick={() => setEnding(c)}>Terminar</Button>
      )}
      {error && <span className="text-red-100">{error}</span>}
      {ending && (
        <ConfirmModal title="Terminar chamada" label="Resultado da chamada (fica na ficha do cliente)" onClose={() => setEnding(null)}
          onConfirm={async (result) => { hangupMedia(); await api(`/communication/calls/${ending.id}/end`, { method: 'POST', body: { result: result || null } }); setCalls([]); }} />
      )}
    </div>
  );
}
