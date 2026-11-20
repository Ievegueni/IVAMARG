import { formatKz, PAY_MODEL, STAGE_TYPE } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { ModelSelect, type Opt } from '../../components/SearchSelect';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td } from '../../components/ui';
import { useStages, useWarehouses, type PStage } from '../../lib/options';
import { useAction, useApi } from '../../lib/useApi';

type Section = { id: string; name: string; active: boolean };
type Operator = { id: string; name: string; code: string; sectionId: string | null; payModel: keyof typeof PAY_MODEL; fixedSalary: number; active: boolean; hasPin: boolean; section: { name: string } | null };
type Rate = { id: string; stageId: string; productModelId: string | null; rate: number; stage: { name: string }; productModel: { reference: string; name: string } | null };

export function ProductionConfigPage() {
  const [tab, setTab] = useState<'stages' | 'operators' | 'rates' | 'sections' | 'defects' | 'warehouses'>('stages');
  return (
    <>
      <PageHeader title="Configuração da produção" />
      <Tabs value={tab} onChange={setTab} tabs={[['stages', 'Etapas'], ['operators', 'Operadores'], ['rates', 'Valores por peça'], ['sections', 'Secções'], ['defects', 'Tipos de defeito'], ['warehouses', 'Armazéns']]} />
      {tab === 'stages' && <StagesTab />}
      {tab === 'operators' && <OperatorsTab />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'sections' && <SimpleTab path="/production/config/sections" label="secção" />}
      {tab === 'defects' && <SimpleTab path="/production/config/defect-types" label="tipo de defeito" />}
      {tab === 'warehouses' && <WarehousesTab />}
    </>
  );
}


function StagesTab() {
  const { can } = useAuth();
  const stages = useStages();
  const sections = useApi<Section[]>('/production/config/sections');
  const { error, act: save } = useAction(stages.reload);
  const [editing, setEditing] = useState<PStage | 'new' | null>(null);
  const editable = can('backoffice.edit');
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <p className="text-sm text-slate-500">A ordem define o fluxo. Uma etapa só inicia com peças concluídas na anterior. "Controlo de qualidade" é o ponto de inspecção.</p>
        {editable && <Button onClick={() => setEditing('new')}>Nova etapa</Button>}
      </div>
      <div className="px-4"><Alert>{error}</Alert></div>
      <Table head={['Ordem', 'Etapa', 'Tipo', 'Secção', 'Estado', '']}>
        {stages.data?.map((s) => (
          <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
            <Td>{s.order}</Td><Td className="font-medium">{s.name}</Td><Td>{STAGE_TYPE[s.type]}</Td>
            <Td>{sections.data?.find((x) => x.id === s.sectionId)?.name ?? '-'}</Td>
            <Td>{s.active ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
            <Td className="text-right">{editable && <button className="text-brand-600 hover:underline" onClick={() => setEditing(s)}>Editar</button>}</Td>
          </tr>
        ))}
      </Table>
      {editing && (
        <StageForm stage={editing === 'new' ? null : editing} sections={sections.data ?? []} nextOrder={Math.max(0, ...(stages.data ?? []).map((s) => s.order)) + 1}
          onClose={() => setEditing(null)} onSave={async (b) => (await save(editing === 'new' ? '/production/config/stages' : `/production/config/stages/${editing.id}`, editing === 'new' ? 'POST' : 'PATCH', b)) && setEditing(null)} />
      )}
    </Card>
  );
}

function StageForm({ stage, sections, nextOrder, onClose, onSave }: { stage: PStage | null; sections: Section[]; nextOrder: number; onClose: () => void; onSave: (b: object) => void }) {
  const [f, setF] = useState({ name: stage?.name ?? '', order: stage?.order ?? nextOrder, type: stage?.type ?? 'INTERNAL', sectionId: stage?.sectionId ?? '', active: stage?.active ?? true });
  return (
    <Modal open title={stage ? 'Editar etapa' : 'Nova etapa'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, sectionId: f.sectionId || null }); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
          <Field label="Ordem"><Input type="number" required value={f.order} onChange={(e) => setF({ ...f, order: Number(e.target.value) })} /></Field>
          <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PStage['type'] })}>
              {Object.entries(STAGE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Secção">
            <Select value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
              <option value="">-</option>
              {sections.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activa</label>
        <p className="text-xs text-amber-700">Mudar a ordem ou desactivar etapas afecta o fluxo dos lotes em curso.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

function OperatorsTab() {
  const { can } = useAuth();
  const ops = useApi<Operator[]>('/production/config/operators');
  const sections = useApi<Section[]>('/production/config/sections');
  const { error, act: save } = useAction(ops.reload);
  const [editing, setEditing] = useState<Operator | 'new' | null>(null);
  const editable = can('backoffice.edit');
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <p className="text-sm text-slate-500">O PIN serve para o operador entrar no ecrã de chão de fábrica. Cada PIN é único.</p>
        {editable && <Button onClick={() => setEditing('new')}>Novo operador</Button>}
      </div>
      <div className="px-4"><Alert>{error}</Alert></div>
      <Table head={['Código', 'Nome', 'Secção', 'Pagamento', 'Fixo mensal', 'PIN', '']}>
        {ops.data?.map((o) => (
          <tr key={o.id} className={o.active ? '' : 'opacity-50'}>
            <Td className="font-mono text-xs">{o.code}</Td><Td className="font-medium">{o.name}</Td><Td>{o.section?.name ?? '-'}</Td>
            <Td>{PAY_MODEL[o.payModel]}</Td><Td>{o.payModel === 'PIECE' ? '-' : formatKz(o.fixedSalary)}</Td>
            <Td>{o.hasPin ? <Badge tone="green">Definido</Badge> : <Badge tone="amber">Sem PIN</Badge>}</Td>
            <Td className="text-right">{editable && <button className="text-brand-600 hover:underline" onClick={() => setEditing(o)}>Editar</button>}</Td>
          </tr>
        ))}
      </Table>
      {editing && <OperatorForm op={editing === 'new' ? null : editing} sections={sections.data ?? []} onClose={() => setEditing(null)}
        onSave={async (b) => (await save(editing === 'new' ? '/production/config/operators' : `/production/config/operators/${editing.id}`, editing === 'new' ? 'POST' : 'PATCH', b)) && setEditing(null)} error={error} />}
    </Card>
  );
}

function OperatorForm({ op, sections, onClose, onSave, error }: { op: Operator | null; sections: Section[]; onClose: () => void; onSave: (b: object) => void; error: string }) {
  const [f, setF] = useState({ name: op?.name ?? '', code: op?.code ?? '', sectionId: op?.sectionId ?? '', payModel: op?.payModel ?? 'PIECE', fixedSalary: op?.fixedSalary ?? 0, active: op?.active ?? true, pin: '' });
  return (
    <Modal open title={op ? `Operador ${op.code}` : 'Novo operador'} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSave({ ...f, sectionId: f.sectionId || null, pin: f.pin || undefined }); }} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <Field label="Código"><Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Nome"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Secção">
            <Select value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
              <option value="">-</option>
              {sections.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Modelo de pagamento">
            <Select value={f.payModel} onChange={(e) => setF({ ...f, payModel: e.target.value as Operator['payModel'] })}>
              {Object.entries(PAY_MODEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {f.payModel !== 'PIECE' && <Field label="Fixo mensal (Kz)"><Input type="number" min={0} step={1} value={f.fixedSalary} onChange={(e) => setF({ ...f, fixedSalary: Number(e.target.value) })} /></Field>}
          <Field label={op?.hasPin ? 'Novo PIN (vazio = manter)' : 'PIN (4 a 6 dígitos)'}><Input inputMode="numeric" pattern="\d{4,6}" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} autoComplete="off" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo</label>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

function RatesTab() {
  const { can } = useAuth();
  const rates = useApi<Rate[]>('/production/config/rates');
  const stages = useStages();
  const { error, act: save } = useAction(rates.reload);
  const [f, setF] = useState({ stageId: '', rate: '' });
  const [model, setModel] = useState<Opt | null>(null);
  const editable = can('backoffice.edit');
  return (
    <Card>
      <p className="p-4 text-sm text-slate-500">Valor pago por peça concluída (operadores "à peça" ou "misto"). Um valor para um modelo específico substitui o valor geral da etapa. O valor fica fixado no registo quando a etapa é concluída.</p>
      <div className="px-4"><Alert>{error}</Alert></div>
      {editable && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await save('/production/config/rates', 'PUT', { stageId: f.stageId, productModelId: model?.id ?? null, rate: f.rate })) { setF({ stageId: '', rate: '' }); setModel(null); } }} className="grid items-end gap-3 px-4 pb-4 sm:grid-cols-[1fr_1fr_140px_auto]">
          <Field label="Etapa">
            <Select required value={f.stageId} onChange={(e) => setF({ ...f, stageId: e.target.value })}>
              <option value="">-</option>
              {stages.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Modelo (vazio = todos)"><ModelSelect value={model} onChange={setModel} /></Field>
          <Field label="Kz por peça"><Input type="number" min={0} step={1} required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
          <Button type="submit">Guardar valor</Button>
        </form>
      )}
      <Table head={['Etapa', 'Modelo', 'Kz/peça', '']} empty={rates.data?.length === 0}>
        {rates.data?.map((r) => (
          <tr key={r.id}>
            <Td>{r.stage.name}</Td><Td>{r.productModel ? `${r.productModel.reference} - ${r.productModel.name}` : <span className="text-slate-500">Todos</span>}</Td>
            <Td className="text-right">{formatKz(r.rate)}</Td>
            <Td className="text-right">{editable && <button className="text-red-600 hover:underline" onClick={() => save(`/production/config/rates/${r.id}`, 'DELETE')}>Remover</button>}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function SimpleTab({ path, label }: { path: string; label: string }) {
  const { can } = useAuth();
  const list = useApi<Section[]>(path);
  const { error, act: save } = useAction(list.reload);
  const [name, setName] = useState('');
  const editable = can('backoffice.edit');
  return (
    <Card>
      <div className="p-4"><Alert>{error}</Alert></div>
      {editable && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await save(path, 'POST', { name })) setName(''); }} className="flex gap-2 px-4 pb-4">
          <Input required placeholder={`Novo ${label}`} value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      <Table head={['Nome', 'Estado', '']}>
        {list.data?.map((s) => (
          <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
            <Td>{s.name}</Td><Td>{s.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
            <Td className="text-right">{editable && <button className="text-brand-600 hover:underline" onClick={() => save(`${path}/${s.id}`, 'PATCH', { active: !s.active })}>{s.active ? 'Desactivar' : 'Activar'}</button>}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function WarehousesTab() {
  const { can } = useAuth();
  const list = useWarehouses();
  const { error, act: save } = useAction(list.reload);
  const [f, setF] = useState({ code: '', name: '' });
  const editable = can('backoffice.edit');
  return (
    <Card>
      <div className="p-4"><Alert>{error}</Alert></div>
      {editable && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await save('/stock/warehouses', 'POST', f)) setF({ code: '', name: '' }); }} className="flex flex-wrap gap-2 px-4 pb-4">
          <Input required placeholder="Código" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="w-32" />
          <Input required placeholder="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="max-w-sm" />
          <Button type="submit">Adicionar armazém</Button>
        </form>
      )}
      <Table head={['Código', 'Nome', 'Estado', '']}>
        {list.data?.map((w) => (
          <tr key={w.id} className={w.active ? '' : 'opacity-50'}>
            <Td className="font-mono text-xs">{w.code}</Td><Td>{w.name}</Td><Td>{w.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
            <Td className="text-right">{editable && <button className="text-brand-600 hover:underline" onClick={() => save(`/stock/warehouses/${w.id}`, 'PATCH', { active: !w.active })}>{w.active ? 'Desactivar' : 'Activar'}</button>}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
