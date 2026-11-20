import { AUTOMATION_RECIPIENT, AUTOMATION_TRIGGERS, CHANNELS, TEMPLATE_VARIABLES, type Channel } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useApi } from '../../lib/useApi';

type Template = { id: string; name: string; channels: Channel[]; subject: string | null; body: string; waTemplateName: string | null; waLanguage: string; active: boolean };
type Automation = { id: string; name: string; trigger: keyof typeof AUTOMATION_TRIGGERS; channel: Channel; templateId: string; recipient: keyof typeof AUTOMATION_RECIPIENT; active: boolean; template: { name: string } };

export function CommsSettingsPage() {
  const [tab, setTab] = useState<'templates' | 'automations' | 'sandbox'>('templates');
  return (
    <>
      <PageHeader title="Comunicação - modelos e automações" />
      <Tabs value={tab} onChange={setTab} tabs={[['templates', 'Modelos de mensagem'], ['automations', 'Automações'], ['sandbox', 'Simulador (sandbox)']]} />
      {tab === 'templates' && <Templates />}
      {tab === 'automations' && <Automations />}
      {tab === 'sandbox' && <Simulator />}
    </>
  );
}

function Templates() {
  const { can } = useAuth();
  const list = useApi<Template[]>('/communication/templates');
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <p className="text-sm text-slate-500">Variáveis: {Object.entries(TEMPLATE_VARIABLES).map(([k, v]) => <code key={k} title={v} className="mr-1 rounded bg-slate-100 px-1 text-xs">{`{{${k}}}`}</code>)}</p>
        {can('backoffice.edit') && <Button onClick={() => setEditing('new')}>Novo modelo</Button>}
      </div>
      <Table head={['Nome', 'Canais', 'Texto', 'WhatsApp (Meta)', '']}>
        {list.data?.map((t) => (
          <tr key={t.id} className={t.active ? '' : 'opacity-50'}>
            <Td className="font-medium">{t.name}</Td>
            <Td>{t.channels.map((c) => CHANNELS[c]).join(', ')}</Td>
            <Td className="max-w-md truncate text-slate-600">{t.body}</Td>
            <Td>{t.channels.includes('WHATSAPP') ? (t.waTemplateName ? <Badge tone="green">{t.waTemplateName}</Badge> : <Badge tone="amber">não aprovado</Badge>) : '-'}</Td>
            <Td className="text-right">{can('backoffice.edit') && <button className="text-brand-600 hover:underline" onClick={() => setEditing(t)}>Editar</button>}</Td>
          </tr>
        ))}
      </Table>
      {editing && <TemplateForm t={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </Card>
  );
}

function TemplateForm({ t, onClose, onSaved }: { t: Template | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: t?.name ?? '', channels: t?.channels ?? ['WHATSAPP'], subject: t?.subject ?? '', body: t?.body ?? '', waTemplateName: t?.waTemplateName ?? '', waLanguage: t?.waLanguage ?? 'pt_PT', active: t?.active ?? true });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(t ? `/communication/templates/${t.id}` : '/communication/templates', { method: t ? 'PATCH' : 'POST', body: f });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={t ? 'Editar modelo' : 'Novo modelo'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Canais">
          <div className="flex flex-wrap gap-3">
            {(Object.keys(CHANNELS) as Channel[]).map((c) => (
              <label key={c} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.channels.includes(c)} onChange={(e) => setF({ ...f, channels: e.target.checked ? [...f.channels, c] : f.channels.filter((x) => x !== c) })} /> {CHANNELS[c]}</label>
            ))}
          </div>
        </Field>
        {f.channels.includes('EMAIL') && <Field label="Assunto (email)"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>}
        <Field label="Texto"><Textarea rows={4} required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        {f.channels.includes('WHATSAPP') && (
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Nome do template aprovado na Meta"><Input value={f.waTemplateName} onChange={(e) => setF({ ...f, waTemplateName: e.target.value })} placeholder="ex.: encomenda_pronta" /></Field>
            <Field label="Idioma"><Input value={f.waLanguage} onChange={(e) => setF({ ...f, waLanguage: e.target.value })} /></Field>
          </div>
        )}
        {f.channels.includes('WHATSAPP') && <p className="text-xs text-slate-500">Fora da janela de 24h o WhatsApp só aceita templates aprovados pela Meta. As variáveis são enviadas como parâmetros pela ordem em que aparecem no texto.</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo</label>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

function Automations() {
  const { can } = useAuth();
  const list = useApi<Automation[]>('/communication/automations');
  const templates = useApi<Template[]>('/communication/templates');
  const [f, setF] = useState({ name: '', trigger: 'ORDER_READY', channel: 'WHATSAPP', templateId: '', recipient: 'CLIENT' });
  const [error, setError] = useState('');
  const editable = can('backoffice.edit');
  const save = async (path: string, method: 'POST' | 'PATCH', body: object) => {
    setError('');
    try {
      await api(path, { method, body });
      list.reload();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    }
  };
  return (
    <Card>
      <div className="p-4"><Alert>{error}</Alert></div>
      {editable && (
        <form className="grid items-end gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-6" onSubmit={async (e) => { e.preventDefault(); if (await save('/communication/automations', 'POST', f)) setF({ ...f, name: '' }); }}>
          <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Quando"><Select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>{Object.entries(AUTOMATION_TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Canal"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['WHATSAPP', 'SMS', 'EMAIL'].map((k) => <option key={k} value={k}>{CHANNELS[k as Channel]}</option>)}</Select></Field>
          <Field label="Modelo"><Select required value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">-</option>{templates.data?.filter((t) => t.channels.includes(f.channel as Channel)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Para"><Select value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })}>{Object.entries(AUTOMATION_RECIPIENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      <Table head={['Automação', 'Quando', 'Canal', 'Modelo', 'Para', 'Estado']} empty={list.data?.length === 0}>
        {list.data?.map((a) => (
          <tr key={a.id}>
            <Td className="font-medium">{a.name}</Td><Td>{AUTOMATION_TRIGGERS[a.trigger]}</Td><Td>{CHANNELS[a.channel]}</Td><Td>{a.template.name}</Td><Td>{AUTOMATION_RECIPIENT[a.recipient]}</Td>
            <Td>{editable ? <button onClick={() => save(`/communication/automations/${a.id}`, 'PATCH', { active: !a.active })}>{a.active ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</button> : a.active ? 'Activa' : 'Inactiva'}</Td>
          </tr>
        ))}
      </Table>
      <p className="p-4 text-xs text-slate-500">"Pagamento em atraso" dispara com o módulo financeiro. Alertas para a direcção por WhatsApp/SMS usam o telemóvel definido em cada utilizador.</p>
    </Card>
  );
}

/** Simula mensagens recebidas (mesmo processamento que o webhook Meta) enquanto as contas não estão aprovadas. */
function Simulator() {
  const [f, setF] = useState({ channel: 'WHATSAPP', from: '', name: '', text: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/communication/simulate-inbound', { method: 'POST', body: f });
      setMsg({ tone: 'success', text: 'Mensagem recebida simulada. Veja na Caixa de entrada.' });
      setF({ ...f, text: '' });
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    }
  };
  return (
    <Card className="max-w-xl p-5">
      <p className="mb-4 text-sm text-slate-600">Enquanto a conta Meta não está aprovada, a comunicação corre em <b>modo sandbox</b>: os envios ficam registados mas não saem, e aqui pode simular mensagens recebidas. O canal tem de estar activo em Configurações → Funcionalidades.</p>
      <form onSubmit={submit} className="space-y-4">
        <Alert tone={msg?.tone}>{msg?.text}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Canal"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['WHATSAPP', 'MESSENGER', 'INSTAGRAM'].map((k) => <option key={k} value={k}>{CHANNELS[k as Channel]}</option>)}</Select></Field>
          <Field label={f.channel === 'WHATSAPP' ? 'Telefone' : 'ID do remetente'}><Input required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder={f.channel === 'WHATSAPP' ? '923 456 789' : 'psid-123'} /></Field>
        </div>
        <Field label="Nome (perfil)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mensagem"><Textarea required value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Simular recepção</Button>
          {f.channel === 'WHATSAPP' && <Button type="button" variant="secondary" onClick={async () => {
            try {
              await api('/communication/calls/simulate-incoming', { method: 'POST', body: { from: f.from } });
              setMsg({ tone: 'success', text: 'Chamada simulada: aparece a barra de chamada no topo (flag "Chamadas WhatsApp" activa).' });
            } catch (err) {
              setMsg({ tone: 'error', text: errMsg(err) });
            }
          }}>Simular chamada recebida</Button>}
        </div>
      </form>
    </Card>
  );
}
