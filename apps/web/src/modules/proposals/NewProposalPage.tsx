import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClientSelect } from '../../components/ClientSelect';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, localDate } from '../../lib/format';
import { useAppSettings, useBusinessLines } from '../../lib/options';
import { useApi } from '../../lib/useApi';
import { emptyItem, ItemsEditor, type Item } from './ItemsEditor';

export function NewProposalPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const lines = useBusinessLines();
  const preset = useApi<{ id: string; name: string; nif: string | null }>(params.get('clientId') ? `/clients/${params.get('clientId')}` : null);
  const settings = useAppSettings();
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ title: '', businessLineId: params.get('businessLineId') ?? '', mode: 'ITEMS', notes: '', validUntil: '' });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [error, setError] = useState('');

  useEffect(() => { if (preset.data) setClient(preset.data); }, [preset.data]);
  useEffect(() => {
    const kind = lines.data?.find((l) => l.id === f.businessLineId)?.kind;
    if (kind) setF((x) => ({ ...x, mode: kind === 'CONSTRUCTION' || kind === 'BOREHOLE' ? 'PHASES' : 'ITEMS' }));
  }, [f.businessLineId, lines.data]);
  useEffect(() => {
    const days = settings.data?.proposalValidityDays ?? 0;
    if (days && !f.validUntil) setF((x) => ({ ...x, validUntil: localDate(new Date(Date.now() + days * 86400000)) }));
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return setError('Seleccione o cliente');
    try {
      const p = await api<{ id: string }>('/proposals', {
        method: 'POST',
        body: { ...f, clientId: client.id, opportunityId: params.get('opportunityId'), validUntil: f.validUntil || null, items },
      });
      navigate(`/propostas/${p.id}`, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <>
      <PageHeader title="Nova proposta" />
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Cliente"><ClientSelect value={client} onChange={setClient} /></Field>
          <Field label="Linha de negócio">
            <Select required value={f.businessLineId} onChange={(e) => setF({ ...f, businessLineId: e.target.value })}>
              <option value="">- Seleccionar -</option>
              {lines.data?.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Título"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Formato">
              <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
                <option value="ITEMS">Itens</option>
                <option value="PHASES">Fases (obra)</option>
              </Select>
            </Field>
            <Field label="Válida até"><Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></Field>
          </div>
        </Card>
        <Card className="p-5"><ItemsEditor items={items} onChange={setItems} phases={f.mode === 'PHASES'} /></Card>
        <Card className="p-5"><Field label="Condições / observações (aparecem no PDF)"><Textarea rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit">Criar proposta</Button>
        </div>
      </form>
    </>
  );
}
