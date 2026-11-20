import { BUSINESS_LINE_KINDS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import type { Stage } from '../../lib/options';
import { useApi } from '../../lib/useApi';

type Line = {
  id: string;
  name: string;
  kind: keyof typeof BUSINESS_LINE_KINDS;
  active: boolean;
  order: number;
  pipelineStages: Stage[];
};

export function BusinessLinesPage() {
  const { can } = useAuth();
  const lines = useApi<Line[]>('/backoffice/business-lines');
  const [editing, setEditing] = useState<Line | 'new' | null>(null);
  const [stagesOf, setStagesOf] = useState<Line | null>(null);
  const [error, setError] = useState('');

  const save = async (l: Line | null, body: Partial<Line>) => {
    setError('');
    try {
      if (l) await api(`/backoffice/business-lines/${l.id}`, { method: 'PATCH', body });
      else await api('/backoffice/business-lines', { method: 'POST', body });
      setEditing(null);
      lines.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Linhas de negócio" actions={can('backoffice.edit') && <Button onClick={() => setEditing('new')}>Nova linha</Button>} />
      <div className="mb-4"><Alert>{error || lines.error}</Alert></div>
      <Card>
        <Table head={['Ordem', 'Nome', 'Tipo', 'Estados do funil', 'Estado', '']} empty={lines.data?.length === 0}>
          {lines.data?.map((l) => (
            <tr key={l.id}>
              <Td>{l.order}</Td>
              <Td className="font-medium">{l.name}</Td>
              <Td className="text-slate-600">{BUSINESS_LINE_KINDS[l.kind]}</Td>
              <Td className="text-slate-500">{l.pipelineStages.filter((s) => s.active).map((s) => s.name).join(' → ')}</Td>
              <Td>{l.active ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
              <Td className="text-right">
                {can('backoffice.edit') && (
                  <span className="space-x-3 whitespace-nowrap">
                    <button className="text-brand-600 hover:underline" onClick={() => setStagesOf(l)}>Estados do funil</button>
                    <button className="text-brand-600 hover:underline" onClick={() => setEditing(l)}>Editar</button>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {stagesOf && <StagesEditor line={lines.data?.find((l) => l.id === stagesOf.id) ?? stagesOf} onClose={() => setStagesOf(null)} reload={lines.reload} />}
      {editing && <LineForm line={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function LineForm({ line, onClose, onSave }: { line: Line | null; onClose: () => void; onSave: (l: Line | null, body: Partial<Line>) => void }) {
  const [form, setForm] = useState({ name: line?.name ?? '', kind: line?.kind ?? 'UNIFORMS', order: line?.order ?? 0, active: line?.active ?? true });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { kind, ...rest } = form;
    onSave(line, line ? rest : { ...rest, kind });
  };
  return (
    <Modal open title={line ? 'Editar linha de negócio' : 'Nova linha de negócio'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Tipo (define o que uma proposta aceite gera)">
          <Select disabled={!!line} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Line['kind'] })}>
            {Object.entries(BUSINESS_LINE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Ordem"><Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Activa
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Estados do funil de uma linha: nome, ordem, ganho/perdido, activo. */
function StagesEditor({ line, onClose, reload }: { line: Line; onClose: () => void; reload: () => void }) {
  const [rows, setRows] = useState(line.pipelineStages.map((s) => ({ ...s })));
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const set = (i: number, d: Partial<Stage>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...d } : r)));

  const save = async () => {
    setError('');
    try {
      for (const r of rows) {
        const orig = line.pipelineStages.find((s) => s.id === r.id)!;
        if (JSON.stringify(orig) !== JSON.stringify(r)) {
          await api(`/backoffice/pipeline-stages/${r.id}`, { method: 'PATCH', body: { name: r.name, order: r.order, isWon: r.isWon, isLost: r.isLost, active: r.active } });
        }
      }
      if (newName.trim()) {
        await api('/backoffice/pipeline-stages', { method: 'POST', body: { businessLineId: line.id, name: newName.trim(), order: Math.max(0, ...rows.map((r) => r.order)) + 1 } });
      }
      reload();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      reload();
    }
  };

  return (
    <Modal open title={`Estados do funil - ${line.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Alert>{error}</Alert>
        <p className="text-xs text-slate-500">"Ganho" fecha a oportunidade como ganha (usado quando a proposta é aceite). "Perdido" exige motivo.</p>
        {rows.sort((a, b) => a.order - b.order).map((r, i) => (
          <div key={r.id} className="grid grid-cols-[56px_1fr] gap-2 rounded-lg border border-slate-200 p-2">
            <Input type="number" value={r.order} onChange={(e) => set(i, { order: Number(e.target.value) })} aria-label="Ordem" />
            <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Nome" />
            <div className="col-span-2 flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.isWon} onChange={(e) => set(i, { isWon: e.target.checked, isLost: e.target.checked ? false : r.isLost })} /> Ganho</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.isLost} onChange={(e) => set(i, { isLost: e.target.checked, isWon: e.target.checked ? false : r.isWon })} /> Perdido</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /> Activo</label>
            </div>
          </div>
        ))}
        <Field label="Novo estado (opcional)"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex.: Visita técnica" /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </div>
      </div>
    </Modal>
  );
}
