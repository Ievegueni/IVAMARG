import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Card, Input, PageHeader, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';

type Setting = { key: string; value: unknown; label: string; description: string | null };
type Flag = { key: string; enabled: boolean; label: string; description: string | null };

export function SettingsPage() {
  const { can } = useAuth();
  const editable = can('backoffice.edit');
  const settings = useApi<Setting[]>('/backoffice/settings');
  const flags = useApi<Flag[]>('/backoffice/feature-flags');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();

  const run = async (fn: () => Promise<unknown>, reload: () => void) => {
    setMsg(undefined);
    try {
      await fn();
      setMsg({ tone: 'success', text: 'Alteração guardada.' });
      reload();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text ?? (settings.error || flags.error)}</Alert></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Gerais</h2>
          <div className="space-y-5">
            {settings.data?.map((s) => (
              <SettingRow key={s.key} s={s} editable={editable}
                onSave={(value) => run(() => api(`/backoffice/settings/${s.key}`, { method: 'PATCH', body: { value } }), settings.reload)} />
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="mb-1 font-semibold">Funcionalidades</h2>
          <p className="mb-4 text-sm text-slate-500">Canais que dependem de aprovação externa ficam desligados até estarem disponíveis.</p>
          <div className="divide-y divide-slate-100">
            {flags.data?.map((f) => (
              <label key={f.key} className="flex items-start justify-between gap-4 py-3">
                <span>
                  <span className="block text-sm font-medium">{f.label}</span>
                  {f.description && <span className="block text-xs text-slate-500">{f.description}</span>}
                </span>
                <input type="checkbox" role="switch" className="mt-1 h-5 w-5 accent-brand-600" disabled={!editable} checked={f.enabled}
                  onChange={(e) => run(() => api(`/backoffice/feature-flags/${f.key}`, { method: 'PATCH', body: { enabled: e.target.checked } }), flags.reload)} />
              </label>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function SettingRow({ s, editable, onSave }: { s: Setting; editable: boolean; onSave: (v: unknown) => void }) {
  const isNumber = typeof s.value === 'number';
  const isList = Array.isArray(s.value);
  const initial = isList ? (s.value as string[]).join(', ') : String(s.value ?? '');
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');

  if (s.key === 'company.logo') {
    const pick = (file: File) => {
      if (file.size > 500 * 1024) return setError('Imagem demasiado grande (máx. 500 KB).');
      const reader = new FileReader();
      reader.onload = () => onSave(reader.result);
      reader.readAsDataURL(file);
    };
    return (
      <div>
        <div className="text-sm font-medium">{s.label}</div>
        {s.description && <div className="mb-2 text-xs text-slate-500">{s.description}</div>}
        {typeof s.value === 'string' && s.value && <img src={s.value} alt="Logótipo" className="mb-2 max-h-16 rounded border border-slate-200 p-1" />}
        {editable && (
          <div className="flex items-center gap-3">
            <input type="file" accept="image/png,image/jpeg" className="text-sm" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
            {s.value ? <button className="text-xs text-red-600 hover:underline" onClick={() => onSave('')}>Remover</button> : null}
          </div>
        )}
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    );
  }

  if (s.value && typeof s.value === 'object' && !isList) return <JsonSetting s={s} editable={editable} onSave={onSave} />;

  const parse = () => (isNumber ? Number(value) : isList ? value.split(',').map((x) => x.trim()).filter(Boolean) : value);
  return (
    <div>
      <div className="text-sm font-medium">{s.label}</div>
      {s.description && <div className="mb-2 text-xs text-slate-500">{s.description}</div>}
      <div className="flex gap-2">
        <Input type={isNumber ? 'number' : 'text'} disabled={!editable} value={value} onChange={(e) => setValue(e.target.value)} />
        {editable && <Button variant="secondary" disabled={value === initial} onClick={() => onSave(parse())}>Guardar</Button>}
      </div>
    </div>
  );
}

/** Configurações estruturadas (ex.: regras de salário): editadas como JSON, validadas no servidor. */
function JsonSetting({ s, editable, onSave }: { s: Setting; editable: boolean; onSave: (v: unknown) => void }) {
  const initial = JSON.stringify(s.value, null, 2);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const save = () => {
    try {
      onSave(JSON.parse(value));
      setError('');
    } catch {
      setError('JSON inválido');
    }
  };
  return (
    <div>
      <div className="text-sm font-medium">{s.label}</div>
      {s.description && <div className="mb-2 text-xs text-slate-500">{s.description}</div>}
      <Textarea rows={10} disabled={!editable} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-xs sm:text-xs" />
      {error && <div className="text-xs text-red-600">{error}</div>}
      {editable && <Button variant="secondary" className="mt-2" disabled={value === initial} onClick={save}>Guardar</Button>}
    </div>
  );
}
