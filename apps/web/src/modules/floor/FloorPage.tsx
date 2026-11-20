import { formatDate } from '@ivamarg/shared';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Input } from '../../components/ui';
import { errMsg } from '../../lib/format';
import { FinishForm, type FinishBody, type StageInfo } from '../production/StageForms';

// Chão de fábrica: dispositivo partilhado. Token do operador só em sessionStorage e sessão
// termina após inactividade, para o próximo operador não registar trabalho em nome do anterior.
const IDLE_MS = 3 * 60_000;
const KEY = 'ivamarg_floor';

type Operator = { id: string; name: string; code: string; section: string | null };
type FlowStage = StageInfo & { inflow: number; available: number; done: number; inProgress: number };
type Lot = {
  id: string; number: string; qrToken: string; size: string | null; quantity: number; status: string; finished: number; complete: boolean;
  productModel: { reference: string; name: string };
  productionOrder: { number: string; status: string; order: { number: string; deadline: string | null; personalizationName: string | null; personalizationNotes: string | null; client: { name: string } } };
  stages: FlowStage[];
  openLogs: { id: string; stageId: string; qtyIn: number; operatorId: string | null; stageName: string; operator: { name: string } | null }[];
};
type MyLog = { id: string; stageId: string; qtyIn: number; stage: { name: string }; lot: { number: string; qrToken: string; size: string | null; productModel: { reference: string } } };

const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { token: string; operator: Operator } | null; } catch { return null; } };

async function floorApi<T>(token: string | null, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/floor${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(data?.error?.message ?? 'Erro de comunicação') as Error & { status: number };
    e.status = res.status;
    throw e;
  }
  return data as T;
}

export function FloorPage() {
  const [params, setParams] = useSearchParams();
  const [session, setSession] = useState(load);
  const [lotCode, setLotCode] = useState<string | null>(params.get('lote'));
  const logout = useCallback(() => { try { sessionStorage.removeItem(KEY); } catch { /* ignora */ } setSession(null); setLotCode(null); }, []);

  // Fim de sessão por inactividade.
  useEffect(() => {
    if (!session) return;
    let t = setTimeout(logout, IDLE_MS);
    const reset = () => { clearTimeout(t); t = setTimeout(logout, IDLE_MS); };
    const evs = ['pointerdown', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, reset));
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [session, logout]);

  const call = useCallback(<T,>(path: string, body?: unknown) =>
    floorApi<T>(session?.token ?? null, path, body).catch((e) => { if (e.status === 401) logout(); throw e; }), [session, logout]);

  return (
    <div className="min-h-screen bg-brand">
      <header className="flex items-center justify-between bg-brand-900 px-4 py-3 text-white">
        <span className="font-semibold">Chão de fábrica</span>
        {session && <span className="text-sm">{session.operator.name} · <button onClick={logout} className="underline">Sair</button></span>}
      </header>
      <main className="mx-auto max-w-lg p-4">
        {!session ? (
          <PinPad onLogin={(s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignora */ } setSession(s); }} />
        ) : lotCode ? (
          <LotView code={lotCode} call={call} operatorId={session.operator.id} onBack={() => { setLotCode(null); setParams({}, { replace: true }); }} />
        ) : (
          <Home call={call} onLot={setLotCode} />
        )}
      </main>
    </div>
  );
}

function PinPad({ onLogin }: { onLogin: (s: { token: string; operator: Operator }) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (p = pin) => {
    if (p.length < 4) return;
    setBusy(true);
    try {
      onLogin(await floorApi('', '/login', { pin: p }));
    } catch (e) {
      setError(errMsg(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => { setError(''); const p = (pin + d).slice(0, 6); setPin(p); if (p.length === 6) submit(p); };
  return (
    <div className="mx-auto max-w-xs pt-6 text-center">
      <h1 className="mb-1 text-xl font-semibold">Introduza o seu PIN</h1>
      <div className="mb-4 h-10 text-3xl tracking-[0.5em]">{'•'.repeat(pin.length) || <span className="text-base tracking-normal text-slate-400">4 a 6 dígitos</span>}</div>
      <Alert>{error}</Alert>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} className="rounded-2xl bg-white py-5 text-2xl font-semibold shadow-sm active:bg-slate-200">{d}</button>
        ))}
        <button onClick={() => setPin(pin.slice(0, -1))} className="rounded-2xl bg-white py-5 text-lg shadow-sm active:bg-slate-200" aria-label="Apagar">⌫</button>
        <button onClick={() => press('0')} className="rounded-2xl bg-white py-5 text-2xl font-semibold shadow-sm active:bg-slate-200">0</button>
        <button onClick={() => submit()} disabled={busy || pin.length < 4} className="rounded-2xl bg-brand-600 py-5 text-lg font-semibold text-white shadow-sm disabled:opacity-40">OK</button>
      </div>
    </div>
  );
}

type Call = <T>(path: string, body?: unknown) => Promise<T>;

function Home({ call, onLot }: { call: Call; onLot: (code: string) => void }) {
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [mine, setMine] = useState<MyLog[]>([]);
  useEffect(() => { call<MyLog[]>('/my-open').then(setMine).catch(() => {}); }, [call]);
  return (
    <div className="space-y-5">
      {scanning ? (
        <Scanner onResult={(c) => { setScanning(false); onLot(c); }} onCancel={() => setScanning(false)} />
      ) : (
        <button onClick={() => setScanning(true)} className="w-full rounded-2xl bg-brand-600 py-8 text-xl font-semibold text-white shadow active:bg-brand-700">📷 Ler QR do lote</button>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) onLot(code.trim()); }} className="flex gap-2">
        <Input placeholder="ou nº do lote (ex.: OP-2026-0001-L01)" value={code} onChange={(e) => setCode(e.target.value)} className="py-3" />
        <Button type="submit">Abrir</Button>
      </form>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Os meus trabalhos em curso</h2>
        {mine.length === 0 && <p className="text-sm text-slate-500">Nenhum.</p>}
        <div className="space-y-2">
          {mine.map((l) => (
            <button key={l.id} onClick={() => onLot(l.lot.qrToken)} className="w-full rounded-xl bg-white p-4 text-left shadow-sm active:bg-slate-50">
              <div className="font-semibold">{l.stage.name} · {l.qtyIn} pç</div>
              <div className="text-sm text-slate-500">{l.lot.number} · {l.lot.productModel.reference}{l.lot.size && ` · ${l.lot.size}`}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Leitura de QR pela câmara: BarcodeDetector nativo quando existe, senão jsQR sobre os frames. */
function Scanner({ onResult, onCancel }: { onResult: (code: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const Detector = (window as unknown as { BarcodeDetector?: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2) {
        let found: string | undefined;
        if (detector) found = (await detector.detect(v).catch(() => []))[0]?.rawValue;
        else if (ctx) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
        }
        if (found) return onResult(found);
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; video.current.play(); } tick(); })
      .catch(() => setError('Não foi possível usar a câmara. Autorize o acesso ou escreva o nº do lote.'));
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onResult]);
  return (
    <div className="space-y-3">
      <Alert>{error}</Alert>
      <video ref={video} playsInline muted className="aspect-square w-full rounded-2xl bg-black object-cover" />
      <Button variant="secondary" className="w-full py-3" onClick={onCancel}>Cancelar</Button>
    </div>
  );
}

function LotView({ code, call, operatorId, onBack }: { code: string; call: Call; operatorId: string; onBack: () => void }) {
  const [lot, setLot] = useState<Lot>();
  const [error, setError] = useState('');
  const [defects, setDefects] = useState<{ id: string; name: string }[]>([]);
  const [starting, setStarting] = useState<FlowStage | null>(null);
  const [qty, setQty] = useState(0);
  const [finishing, setFinishing] = useState<Lot['openLogs'][number] | null>(null);
  const [ok, setOk] = useState('');

  const reload = useCallback(() => call<Lot>(`/lots/${encodeURIComponent(code)}`).then((l) => { setLot(l); setError(''); }).catch((e) => setError(errMsg(e))), [call, code]);
  useEffect(() => { reload(); call<{ id: string; name: string }[]>('/defect-types').then(setDefects).catch(() => {}); }, [reload, call]);

  if (error && !lot) return <div className="space-y-3"><Alert>{error}</Alert><Button className="w-full py-3" onClick={onBack}>Voltar</Button></div>;
  if (!lot) return <div className="text-slate-500">A carregar…</div>;

  const start = async () => {
    try {
      await call('/start', { lotId: lot.id, stageId: starting!.id, quantity: qty });
      setOk(`${starting!.name} iniciada (${qty} pç).`);
      setStarting(null);
      reload();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const finish = async (b: FinishBody) => {
    await call(`/logs/${finishing!.id}/finish`, b);
    setOk(`${finishing!.stageName} concluída.`);
    setFinishing(null);
    reload();
  };

  if (finishing) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Concluir {finishing.stageName} - {lot.number}</h2>
        <FinishForm large log={finishing} stage={lot.stages.find((s) => s.id === finishing.stageId)!} stages={lot.stages} defectTypes={defects} onSubmit={finish} />
        <Button variant="secondary" className="w-full py-3" onClick={() => setFinishing(null)}>Voltar</Button>
      </div>
    );
  }
  if (starting) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-semibold">Iniciar {starting.name}</h2>
        <p className="text-slate-500">{lot.number} · disponíveis {starting.available}</p>
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => setQty(Math.max(1, qty - 1))} className="h-16 w-16 rounded-full bg-white text-3xl shadow">−</button>
          <input type="number" min={1} max={starting.available} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-28 rounded-xl border border-slate-300 py-3 text-center text-3xl font-semibold" />
          <button onClick={() => setQty(Math.min(starting.available, qty + 1))} className="h-16 w-16 rounded-full bg-white text-3xl shadow">+</button>
        </div>
        <Alert>{error}</Alert>
        <Button className="w-full py-4 text-lg" disabled={qty < 1 || qty > starting.available} onClick={start}>Iniciar {qty} peça(s)</Button>
        <Button variant="secondary" className="w-full py-3" onClick={() => setStarting(null)}>Voltar</Button>
      </div>
    );
  }

  const mine = lot.openLogs.filter((l) => l.operatorId === operatorId);
  const o = lot.productionOrder.order;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-xl font-bold">{lot.number}</div>
        <div className="text-slate-600">{lot.productModel.reference} {lot.productModel.name}</div>
        <div className="mt-1 text-2xl font-semibold">{lot.size ? `Tam. ${lot.size} · ` : ''}{lot.quantity} pç</div>
        <div className="mt-2 text-sm text-slate-500">{o.client.name} · {o.number}{o.deadline && ` · prazo ${formatDate(o.deadline)}`}</div>
        {(o.personalizationName || o.personalizationNotes) && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Personalização: {[o.personalizationName, o.personalizationNotes].filter(Boolean).join(' - ')}</div>}
        {lot.complete && <div className="mt-2 rounded-lg bg-green-50 p-2 text-sm text-green-800">Lote concluído ({lot.finished} peças).</div>}
      </div>
      <Alert tone="success">{ok}</Alert>
      <Alert>{error}</Alert>
      {mine.map((l) => (
        <button key={l.id} onClick={() => { setOk(''); setFinishing(l); }} className="w-full rounded-2xl bg-green-600 py-5 text-lg font-semibold text-white shadow active:bg-green-700">
          ✔ Concluir {l.stageName} ({l.qtyIn} pç)
        </button>
      ))}
      <div className="space-y-2">
        {lot.stages.map((s) => {
          const others = lot.openLogs.filter((l) => l.stageId === s.id && l.operatorId !== operatorId);
          const canStart = s.available > 0 && s.type !== 'EXTERNAL' && lot.productionOrder.status === 'RELEASED';
          return (
            <div key={s.id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-slate-500">
                  {s.done}/{s.inflow} feitas{s.inProgress ? ` · ${s.inProgress} em curso` : ''}{others.length > 0 && ` (${others.map((x) => x.operator?.name).filter(Boolean).join(', ')})`}
                  {s.type === 'EXTERNAL' && ' · externa (escritório)'}
                </div>
              </div>
              {canStart && <Button onClick={() => { setOk(''); setError(''); setQty(s.available); setStarting(s); }} className="px-5 py-3">Iniciar ({s.available})</Button>}
            </div>
          );
        })}
      </div>
      <Button variant="secondary" className="w-full py-3" onClick={onBack}>Outro lote</Button>
    </div>
  );
}
