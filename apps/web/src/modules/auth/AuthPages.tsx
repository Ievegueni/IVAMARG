import { LogoMark } from '../../components/Logo';
import { Briefcase, Factory, Package, Wallet, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Button, Field, Input } from '../../components/ui';
import { api } from '../../lib/api';

const FEATURES: [LucideIcon, string][] = [
  [Factory, 'Produção da fábrica acompanhada lote a lote, com QR'],
  [Package, 'Stock, compras e consumos sempre actualizados'],
  [Briefcase, 'Clientes, propostas e encomendas num só sítio'],
  [Wallet, 'Facturação Vendus, cobranças e comissões'],
];

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-slate-900 p-12 text-white lg:flex">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-[#ff0a8c]/25 blur-3xl" aria-hidden />
        <div className="relative self-center text-center" role="img" aria-label="Ivamarg">
          <LogoMark className="mx-auto w-56" diamond="#fff" />
          <p className="mt-4 pl-[0.3em] text-4xl font-medium tracking-[0.3em] text-white">IVAMARG</p>
          <p className="mt-2 pl-[0.25em] text-[11px] tracking-[0.25em] text-slate-300">INVESTIMENTOS E PARTICIPAÇÕES</p>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">Gestão integrada da Ivamarg</h2>
          <p className="mt-3 text-slate-400">Construção, fábrica de uniformes, limpeza e jardinagem e furos de água - numa só plataforma.</p>
          <ul className="mt-10 space-y-4">
            {FEATURES.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10"><Icon size={18} className="text-blue-400" aria-hidden /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">© Ivamarg, Lda · Luanda</p>
      </aside>
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#f6f5f7] p-6">
        <LogoMark className="pointer-events-none absolute top-1/2 left-1/2 w-[min(90%,40rem)] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]" diamond="#1f1f23" />
        <div className="relative w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">I</span>
            <span className="text-lg font-semibold text-slate-900">Ivamarg</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Entrar na plataforma">
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Palavra-passe">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Link to="/recuperar-palavra-passe" className="text-sm font-medium text-brand-600 hover:text-brand-700">Esqueceu a palavra-passe?</Link>
        </div>
        <Button type="submit" disabled={busy} className="h-11 w-full">{busy ? 'A entrar…' : 'Entrar'}</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <AuthShell title="Recuperar palavra-passe">
      {sent ? (
        <Alert tone="success">Se o email estiver registado, vai receber um link para definir uma nova palavra-passe.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Alert>{error}</Alert>
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full">Enviar link</Button>
        </form>
      )}
      <Link to="/entrar" className="mt-4 block text-center text-sm text-brand-600 hover:underline">Voltar ao início de sessão</Link>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('As palavras-passe não coincidem.');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <AuthShell title="Definir nova palavra-passe">
      {done ? (
        <Alert tone="success">Palavra-passe alterada. Já pode entrar.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Alert>{error}</Alert>
          <Field label="Nova palavra-passe (mín. 8 caracteres)">
            <Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirmar palavra-passe">
            <Input type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full">Guardar</Button>
        </form>
      )}
      <Link to="/entrar" className="mt-4 block text-center text-sm text-brand-600 hover:underline">Ir para o início de sessão</Link>
    </AuthShell>
  );
}
