import { ATTENDANCE_STATUS, CONTRACT_TYPES, EMPLOYEE_STATUS, formatDate, parseBiometric, PAYMENT_METHODS, salaryInstalment, formatKz, LEAVE_STATUS, LEAVE_TYPES, PAYROLL_STATUS } from '@ivamarg/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '../../components/ui';
import { readSheet } from 'read-excel-file/browser';
import { DocumentsPanel } from '../documents/DocumentsPage';
import { parseCsv } from '../../components/ImportWizard';
import { api, openFile, toQuery, upload } from '../../lib/api';
import { errMsg, localDate, toDateInput } from '../../lib/format';
import { useAction, useApi, type Page } from '../../lib/useApi';

type Employee = {
  id: string; number: string; name: string; bi: string | null; nif: string | null; inssNumber: string | null; birthDate: string | null; phone: string | null; email: string | null; address: string | null;
  position: string; department: string | null; hireDate: string; contractType: keyof typeof CONTRACT_TYPES; contractEnd: string | null;
  baseSalary: number; mealAllowance: number; transportAllowance: number; otherAllowances: number; vacationDays: number; bank: string | null; iban: string | null;
  status: keyof typeof EMPLOYEE_STATUS; operatorId: string | null; biometricId: string | null; operator: { id: string; code: string; name: string } | null; notes: string | null;
};
type Leave = { id: string; type: keyof typeof LEAVE_TYPES; startDate: string; endDate: string; days: number; status: keyof typeof LEAVE_STATUS; reason: string | null; comment: string | null; attachmentName: string | null; employee?: { id: string; number: string; name: string } };
type Slip = {
  id: string; employeeId: string; baseSalary: number; mealAllowance: number; transportAllowance: number; otherAllowances: number; overtimeHours: number; overtimePay: number;
  absences: number; absenceDeduction: number; piecePay: number; bonus: number; otherDeductions: number; gross: number; inssEmployee: number; inssEmployer: number; irt: number; net: number; notes: string | null;
  paid: number; payments?: { id: string; amount: number; method: keyof typeof PAYMENT_METHODS; paidAt: string; reference: string | null; cancelledAt: string | null }[];
  employee: { id: string; number: string; name: string; position: string; department?: string | null };
  run?: { id: string; period: string; status: keyof typeof PAYROLL_STATUS };
};
type Totals = { gross: number; net: number; paid: number; inss: number; irt: number; employerCost: number };
type Run = { id: string; period: string; status: keyof typeof PAYROLL_STATUS; count: number } & Totals;

const statusTone = (s: string) => (['ACTIVE', 'APPROVED', 'PAID', 'PRESENT'].includes(s) ? 'green' : ['PENDING', 'SUSPENDED', 'LATE', 'DRAFT', 'PARTIAL'].includes(s) ? 'amber' : ['REJECTED', 'TERMINATED', 'ABSENT'].includes(s) ? 'red' : 'slate');
const thisMonth = () => localDate().slice(0, 7);

// ── Trabalhadores ──

export function EmployeesList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: 'ACTIVE' });
  const list = useApi<Page<Employee>>(`/hr/employees${toQuery({ page, ...f })}`);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Trabalhadores" actions={can('hr.create') && <Button onClick={() => setCreating(true)}>Novo trabalhador</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Nome, número, BI, NIF, função…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}>
          <option value="">Todos</option>
          {Object.entries(EMPLOYEE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <Card>
        <Table head={['Número', 'Nome', 'Função', 'Departamento', 'Admissão', 'Salário base', 'Estado']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((e) => (
            <tr key={e.id} className="cursor-pointer" onClick={() => navigate(`/rh/trabalhadores/${e.id}`)}>
              <Td className="font-medium">{e.number}</Td><Td>{e.name}</Td><Td>{e.position}</Td><Td>{e.department ?? '-'}</Td><Td>{formatDate(e.hireDate)}</Td>
              <Td className="text-right">{formatKz(e.baseSalary)}</Td><Td><Badge tone={statusTone(e.status)}>{EMPLOYEE_STATUS[e.status]}</Badge></Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {creating && <EmployeeForm emp={null} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/rh/trabalhadores/${e.id}`)} />}
    </>
  );
}

function EmployeeForm({ emp, onClose, onSaved }: { emp: Employee | null; onClose: () => void; onSaved: (e: Employee) => void }) {
  const { can } = useAuth();
  const operators = useApi<{ id: string; code: string; name: string }[]>(can('production.view') ? '/production/config/operators' : null);
  const [f, setF] = useState({
    name: emp?.name ?? '', bi: emp?.bi ?? '', nif: emp?.nif ?? '', inssNumber: emp?.inssNumber ?? '', birthDate: toDateInput(emp?.birthDate), phone: emp?.phone ?? '', email: emp?.email ?? '', address: emp?.address ?? '',
    position: emp?.position ?? '', department: emp?.department ?? '', hireDate: toDateInput(emp?.hireDate) || localDate(), contractType: emp?.contractType ?? 'EFFECTIVE', contractEnd: toDateInput(emp?.contractEnd),
    baseSalary: emp?.baseSalary ?? 0, mealAllowance: emp?.mealAllowance ?? 0, transportAllowance: emp?.transportAllowance ?? 0, otherAllowances: emp?.otherAllowances ?? 0, vacationDays: emp?.vacationDays ?? 22,
    bank: emp?.bank ?? '', iban: emp?.iban ?? '', status: emp?.status ?? 'ACTIVE', operatorId: emp?.operatorId ?? '', biometricId: emp?.biometricId ?? '', notes: emp?.notes ?? '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: typeof f[k] === 'number' ? Number(e.target.value) : e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, birthDate: f.birthDate || null, contractEnd: f.contractEnd || null };
    try {
      onSaved(await api<Employee>(emp ? `/hr/employees/${emp.id}` : '/hr/employees', { method: emp ? 'PATCH' : 'POST', body }));
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const kz = (k: 'baseSalary' | 'mealAllowance' | 'transportAllowance' | 'otherAllowances', label: string) => (
    <Field label={label}><Input type="number" min={0} step={1} value={f[k]} onChange={set(k)} /></Field>
  );
  return (
    <Modal open wide title={emp ? `Editar ${emp.number}` : 'Novo trabalhador'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Identificação</legend>
          <div className="sm:col-span-2"><Field label="Nome completo"><Input required value={f.name} onChange={set('name')} /></Field></div>
          <Field label="Data de nascimento"><Input type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
          <Field label="BI"><Input value={f.bi} onChange={set('bi')} /></Field>
          <Field label="NIF"><Input value={f.nif} onChange={set('nif')} /></Field>
          <Field label="N.º Segurança Social"><Input value={f.inssNumber} onChange={set('inssNumber')} /></Field>
          <Field label="Telefone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Morada"><Input value={f.address} onChange={set('address')} /></Field>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Contrato</legend>
          <Field label="Função"><Input required value={f.position} onChange={set('position')} /></Field>
          <Field label="Departamento"><Input value={f.department} onChange={set('department')} placeholder="Fábrica, Obras, Limpeza…" /></Field>
          <Field label="Estado"><Select value={f.status} onChange={set('status')}>{Object.entries(EMPLOYEE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Data de admissão"><Input type="date" required value={f.hireDate} onChange={set('hireDate')} /></Field>
          <Field label="Tipo de contrato"><Select value={f.contractType} onChange={set('contractType')}>{Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Fim do contrato"><Input type="date" value={f.contractEnd} onChange={set('contractEnd')} /></Field>
          <Field label="Dias de férias por ano"><Input type="number" min={0} max={60} value={f.vacationDays} onChange={set('vacationDays')} /></Field>
          <Field label="N.º no relógio biométrico"><Input value={f.biometricId} onChange={set('biometricId')} placeholder="sJobNo" /></Field>
          {operators.data && (
            <div className="sm:col-span-2">
              <Field label="Operador da fábrica (produção à peça entra no salário)">
                <Select value={f.operatorId} onChange={set('operatorId')}><option value="">-</option>{operators.data.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}</Select>
              </Field>
            </div>
          )}
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Remuneração mensal (Kz)</legend>
          {kz('baseSalary', 'Salário base')}{kz('mealAllowance', 'Sub. alimentação')}{kz('transportAllowance', 'Sub. transporte')}{kz('otherAllowances', 'Outros subsídios')}
          <Field label="Banco"><Input value={f.bank} onChange={set('bank')} /></Field>
          <div className="sm:col-span-3"><Field label="IBAN"><Input value={f.iban} onChange={set('iban')} placeholder="AO06 …" /></Field></div>
        </fieldset>
        <Field label="Notas"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export function EmployeeDetail() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const navigate = useNavigate();
  const res = useApi<Employee & { leaves: Leave[]; payslips: Slip[]; vacation: { year: number; entitled: number; used: number; pending: number; available: number } }>(`/hr/employees/${id}`);
  const [editing, setEditing] = useState(false);
  const [leave, setLeave] = useState(false);
  const [removing, setRemoving] = useState(false);
  const e = res.data;
  if (res.error) return <Alert>{res.error}</Alert>;
  if (!e) return <div className="text-slate-500">A carregar…</div>;
  const info: [string, React.ReactNode][] = [
    ['Função', [e.position, e.department].filter(Boolean).join(' / ')], ['Estado', <Badge tone={statusTone(e.status)}>{EMPLOYEE_STATUS[e.status]}</Badge>],
    ['Admissão', formatDate(e.hireDate)], ['Contrato', `${CONTRACT_TYPES[e.contractType]}${e.contractEnd ? ` até ${formatDate(e.contractEnd)}` : ''}`],
    ['BI', e.bi], ['NIF', e.nif], ['Segurança Social', e.inssNumber], ['Telefone', e.phone], ['Email', e.email], ['Morada', e.address],
    ['Banco / IBAN', [e.bank, e.iban].filter(Boolean).join(' ')], ['Operador', e.operator && `${e.operator.code} - ${e.operator.name}`], ['N.º biométrico', e.biometricId],
  ];
  return (
    <>
      <PageHeader title={`${e.number} - ${e.name}`} actions={
        <div className="flex flex-wrap gap-2">
          {can('hr.create') && <Button variant="secondary" onClick={() => setLeave(true)}>Pedir férias / ausência</Button>}
          {can('hr.edit') && <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}
          {can('hr.delete') && <Button variant="danger" onClick={() => setRemoving(true)}>Eliminar</Button>}
        </div>
      } />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([['Salário base', e.baseSalary], ['Subsídios', e.mealAllowance + e.transportAllowance + e.otherAllowances]] as const).map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{formatKz(v)}</div></Card>
        ))}
        {([['Férias ' + e.vacation.year, `${e.vacation.entitled} dias`], ['Gozadas', `${e.vacation.used} dias`], ['Disponíveis', `${e.vacation.available} dias${e.vacation.pending ? ` (${e.vacation.pending} pendentes)` : ''}`]] as const).map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{v}</div></Card>
        ))}
      </div>
      <Card className="mb-6 grid grid-cols-2 gap-4 p-5 text-sm lg:grid-cols-4">
        {info.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="text-xs text-slate-500">{k}</div>{v}</div>)}
        {e.notes && <div className="col-span-2 lg:col-span-4"><div className="text-xs text-slate-500">Notas</div>{e.notes}</div>}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Férias e ausências</h2>
          <Table head={['Tipo', 'Período', 'Dias', 'Estado', 'Documento']} empty={!e.leaves.length}>
            {e.leaves.map((l) => <tr key={l.id}><Td>{LEAVE_TYPES[l.type]}</Td><Td>{formatDate(l.startDate)} → {formatDate(l.endDate)}</Td><Td>{l.days}</Td><Td><Badge tone={statusTone(l.status)}>{LEAVE_STATUS[l.status]}</Badge></Td><Td><LeaveFile l={l} onChanged={res.reload} /></Td></tr>)}
          </Table>
        </Card>
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Recibos de vencimento</h2>
          <Table head={['Mês', 'Ilíquido', 'Líquido', '']} empty={!e.payslips.length}>
            {e.payslips.map((p) => (
              <tr key={p.id}>
                <Td><Link className="text-brand-600 hover:underline" to={`/rh/salarios/${p.run!.id}`}>{p.run!.period}</Link></Td><Td className="text-right">{formatKz(p.gross)}</Td><Td className="text-right font-medium">{formatKz(p.net)}</Td>
                <Td>{can('hr.export') && <button className="cursor-pointer text-brand-600 hover:underline" onClick={() => openFile(`/hr/payroll/${p.run!.id}/pdf?employeeId=${e.id}`)}>PDF</button>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <div className="mt-6">
        <h2 className="mb-1 font-semibold">Documentos</h2>
        <p className="mb-3 text-sm text-slate-500">BI, carta de condução, certificados… Com data de validade, o trabalhador recebe uma mensagem para o actualizar antes de expirar.</p>
        <DocumentsPanel entity="Employee" entityId={e.id} />
      </div>
      {editing && <EmployeeForm emp={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); res.reload(); }} />}
      {leave && <LeaveForm employeeId={e.id} onClose={() => setLeave(false)} onSaved={() => { setLeave(false); res.reload(); }} />}
      {removing && <ConfirmModal danger title="Eliminar trabalhador" message={`${e.name} deixa de aparecer nas listas. O histórico (assiduidade, recibos) é mantido.`} onClose={() => setRemoving(false)}
        onConfirm={async () => { await api(`/hr/employees/${e.id}`, { method: 'DELETE' }); navigate('/rh/trabalhadores'); }} />}
    </>
  );
}

// ── Assiduidade ──

type SheetRow = { employee: { id: string; number: string; name: string; position: string }; record: { status: keyof typeof ATTENDANCE_STATUS; checkIn: string | null; checkOut: string | null; overtimeHours: number; notes: string | null } | null };

export function AttendancePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'day' | 'month' | 'import'>('day');
  return (
    <>
      <PageHeader title="Assiduidade" actions={
        <div className="inline-flex gap-1 rounded-lg bg-slate-200/60 p-1">
          {([['day', 'Registo diário'], ['month', 'Resumo do mês'], ...(can('hr.edit') ? [['import', 'Importar biométrico']] as const : [])] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`cursor-pointer rounded-md px-3.5 py-1.5 text-sm ${tab === k ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
      } />
      {tab === 'day' ? <DaySheet /> : tab === 'month' ? <MonthSummary /> : <BiometricImport />}
    </>
  );
}

function DaySheet() {
  const { can } = useAuth();
  const [date, setDate] = useState(localDate());
  const sheet = useApi<{ date: string; isHoliday: boolean; rows: SheetRow[] }>(`/hr/attendance?date=${date}`);
  const [edits, setEdits] = useState<Record<string, NonNullable<SheetRow['record']>>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const editable = can('hr.edit');
  const rowOf = (r: SheetRow) => edits[r.employee.id] ?? r.record ?? { status: 'PRESENT' as const, checkIn: '', checkOut: '', overtimeHours: 0, notes: '' };
  const change = (r: SheetRow, patch: Partial<NonNullable<SheetRow['record']>>) => setEdits({ ...edits, [r.employee.id]: { ...rowOf(r), ...patch } });
  const save = async () => {
    setMsg(undefined);
    try {
      // Grava todos os trabalhadores do dia (os não alterados ficam como "Presente").
      await api('/hr/attendance', { method: 'PUT', body: { date, rows: sheet.data!.rows.map((r) => ({ employeeId: r.employee.id, ...rowOf(r) })) } });
      setEdits({});
      setMsg({ tone: 'success', text: 'Assiduidade guardada.' });
      sheet.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Dia"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setEdits({}); }} /></Field>
        {sheet.data?.isHoliday && <Badge tone="amber">Feriado</Badge>}
        {editable && sheet.data && sheet.data.rows.length > 0 && <Button onClick={save}>Guardar dia</Button>}
      </div>
      <div className="mb-4"><Alert tone={msg?.tone}>{msg?.text ?? sheet.error}</Alert></div>
      <Card>
        <Table head={['Trabalhador', 'Estado', 'Entrada', 'Saída', 'Horas extra', 'Notas']} empty={sheet.data?.rows.length === 0}>
          {sheet.data?.rows.map((r) => {
            const v = rowOf(r);
            const unsaved = !r.record || !!edits[r.employee.id];
            return (
              <tr key={r.employee.id}>
                <Td><div className="font-medium">{r.employee.name}</div><div className="text-xs text-slate-500">{r.employee.number} · {r.employee.position}{unsaved && editable ? ' · por guardar' : ''}</div></Td>
                <Td><Select disabled={!editable} value={v.status} onChange={(e) => change(r, { status: e.target.value as typeof v.status })} className="min-w-36">{Object.entries(ATTENDANCE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Td>
                <Td><Input disabled={!editable} type="time" value={v.checkIn ?? ''} onChange={(e) => change(r, { checkIn: e.target.value })} /></Td>
                <Td><Input disabled={!editable} type="time" value={v.checkOut ?? ''} onChange={(e) => change(r, { checkOut: e.target.value })} /></Td>
                <Td><Input disabled={!editable} type="number" min={0} max={24} step={0.5} value={v.overtimeHours} onChange={(e) => change(r, { overtimeHours: Number(e.target.value) })} className="w-24" /></Td>
                <Td><Input disabled={!editable} value={v.notes ?? ''} onChange={(e) => change(r, { notes: e.target.value })} /></Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

function MonthSummary() {
  const [period, setPeriod] = useState(thisMonth());
  const res = useApi<{ employee: { id: string; number: string; name: string }; counts: Record<string, number>; overtimeHours: number; days: number }[]>(`/hr/attendance/month?period=${period}`);
  const cols = ['PRESENT', 'LATE', 'ABSENT', 'JUSTIFIED', 'VACATION', 'SICK'] as const;
  return (
    <>
      <div className="mb-4"><Field label="Mês"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="max-w-48" /></Field></div>
      <Alert>{res.error}</Alert>
      <Card>
        <Table head={['Trabalhador', ...cols.map((c) => ATTENDANCE_STATUS[c]), 'Horas extra']} empty={res.data?.length === 0}>
          {res.data?.map((r) => (
            <tr key={r.employee.id}>
              <Td><Link className="font-medium text-brand-600 hover:underline" to={`/rh/trabalhadores/${r.employee.id}`}>{r.employee.name}</Link></Td>
              {cols.map((c) => <Td key={c} className={`text-center ${c === 'ABSENT' && r.counts[c] ? 'font-semibold text-red-700' : ''}`}>{r.counts[c] ?? 0}</Td>)}
              <Td className="text-center">{r.overtimeHours}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

type BioReport = {
  from: string; to: string; punches: number; records: number; kept: number;
  employees: { employee: { id: string; number: string; name: string; biometricId: string }; present: number; late: number; absent: number; incomplete: number; overtimeHours: number }[];
  unmatched: { id: string; name: string; punches: number }[];
};

/** Exportação do relógio (CSV/Excel) → marcações lidas no browser → cálculo e gravação no servidor. */
function BiometricImport() {
  const [punches, setPunches] = useState<ReturnType<typeof parseBiometric>>([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [report, setReport] = useState<BioReport>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (p: typeof punches, r: typeof range, dryRun: boolean) => {
    setError(''); setBusy(true);
    try {
      setReport(await api<BioReport>('/hr/attendance/import', { method: 'POST', body: { punches: p, ...r, dryRun } }));
      setSaved(!dryRun);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const load = async (file: File) => {
    setReport(undefined); setSaved(false); setError('');
    try {
      const matrix = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : ((await readSheet(file)) as unknown[][]);
      const p = parseBiometric(matrix);
      if (!p.length) return setError('O ficheiro não tem marcações válidas.');
      const dates = p.map((x) => x.date).sort();
      // Por defeito o último mês do ficheiro (ficheiros do relógio trazem todo o histórico).
      const r = { from: dates[dates.length - 1].slice(0, 8) + '01', to: dates[dates.length - 1] };
      setPunches(p); setRange(r);
      await send(p, r, true);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const setR = (k: 'from' | 'to') => (e: { target: { value: string } }) => { const r = { ...range, [k]: e.target.value }; setRange(r); if (r.from && r.to) send(punches, r, true); };
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5 text-sm">
        <p>Carregue o ficheiro exportado do relógio biométrico (CSV ou Excel, com as colunas <b>sJobNo</b>, <b>Date</b> e <b>Time</b>). Cada trabalhador é reconhecido pelo <b>N.º no relógio biométrico</b> da ficha.</p>
        <p className="text-slate-500">Entrada = 1.ª marcação do dia, saída = última. Atraso, horas extra e faltas (dias úteis sem marcação) são calculados pelo horário definido no backoffice (RH: horário). Faltas justificadas, férias e doença já registadas não são alteradas. Nada é gravado até confirmar.</p>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} className="text-sm" />
        {punches.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="De"><Input type="date" value={range.from} onChange={setR('from')} /></Field>
            <Field label="Até"><Input type="date" value={range.to} onChange={setR('to')} /></Field>
            <span className="pb-2 text-slate-500">{punches.length} marcações no ficheiro</span>
          </div>
        )}
      </Card>
      <Alert tone={saved ? 'success' : undefined}>{error || (saved ? `Assiduidade gravada: ${report?.records} registos de ${formatDate(report!.from)} a ${formatDate(report!.to)}.` : '')}</Alert>
      {report && (
        <>
          {report.unmatched.length > 0 && (
            <Card className="p-4 text-sm">
              <h3 className="mb-2 font-semibold text-amber-700">N.º do relógio sem trabalhador ({report.unmatched.length}) - marcações ignoradas</h3>
              <p className="mb-2 text-slate-500">Preencha o "N.º no relógio biométrico" na ficha do trabalhador e volte a carregar o ficheiro.</p>
              <div className="flex flex-wrap gap-2">{report.unmatched.map((u) => <Badge key={u.id} tone="amber">{u.id}{u.name && ` · ${u.name}`} ({u.punches})</Badge>)}</div>
            </Card>
          )}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <span>{report.records} registos a gravar{report.kept > 0 && ` · ${report.kept} dias mantidos (justificações/férias)`}</span>
              {!saved && <Button disabled={busy || !report.records} onClick={() => send(punches, range, false)}>{busy ? 'A gravar…' : 'Confirmar e gravar'}</Button>}
            </div>
            <Table head={['Trabalhador', 'N.º relógio', 'Presente', 'Atraso', 'Faltas', 'Sem entrada/saída', 'Horas extra']} empty={!report.employees.length}>
              {report.employees.map((r) => (
                <tr key={r.employee.id}>
                  <Td><Link className="font-medium text-brand-600 hover:underline" to={`/rh/trabalhadores/${r.employee.id}`}>{r.employee.name}</Link></Td>
                  <Td className="text-center">{r.employee.biometricId}</Td>
                  <Td className="text-center">{r.present}</Td>
                  <Td className={`text-center ${r.late ? 'font-semibold text-amber-700' : ''}`}>{r.late}</Td>
                  <Td className={`text-center ${r.absent ? 'font-semibold text-red-700' : ''}`}>{r.absent}</Td>
                  <Td className="text-center">{r.incomplete}</Td>
                  <Td className="text-center">{r.overtimeHours}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Férias e ausências ──

/** Documento justificativo do pedido: ver, ou anexar/substituir. */
function LeaveFile({ l, onChanged }: { l: Leave; onChanged: () => void }) {
  const { can } = useAuth();
  const [error, setError] = useState('');
  const view = async () => {
    try {
      window.open((await api<{ url: string }>(`/hr/leaves/${l.id}/attachment`)).url, '_blank');
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const attach = async (file: File) => {
    try {
      await upload(`/hr/leaves/${l.id}/attachment`, file);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      {l.attachmentName && <button className="max-w-40 cursor-pointer truncate text-brand-600 hover:underline" title={l.attachmentName} onClick={view}>{l.attachmentName}</button>}
      {can('hr.create') && (
        <label className="cursor-pointer text-xs text-slate-500 hover:underline">
          {l.attachmentName ? 'Substituir' : 'Anexar'}
          <input type="file" className="hidden" accept=".pdf,image/*,.doc,.docx" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
        </label>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}


function LeaveForm({ employeeId, onClose, onSaved }: { employeeId?: string; onClose: () => void; onSaved: () => void }) {
  const employees = useApi<Page<Employee>>(employeeId ? null : '/hr/employees?status=ACTIVE&pageSize=100');
  const [f, setF] = useState({ employeeId: employeeId ?? '', type: 'VACATION', startDate: '', endDate: '', reason: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const l = await api<{ id: string }>('/hr/leaves', { method: 'POST', body: f });
      if (file) await upload(`/hr/leaves/${l.id}/attachment`, file).catch((err) => { throw new Error(`Pedido registado, mas o documento não foi enviado: ${errMsg(err)}`); });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title="Pedido de férias / ausência" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {!employeeId && (
          <Field label="Trabalhador"><Select required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Seleccione…</option>{employees.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        )}
        <Field label="Tipo"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="De"><Input type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate || e.target.value })} /></Field>
          <Field label="Até"><Input type="date" required value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500">Contam só os dias úteis (sem fins-de-semana nem feriados configurados).</p>
        <Field label="Motivo / observações"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {f.type !== 'VACATION' && (
          <Field label="Documento justificativo (atestado, declaração…)">
            <input type="file" accept=".pdf,image/*,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
        )}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Registar</Button></div>
      </form>
    </Modal>
  );
}

export function LeavesPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const list = useApi<Page<Leave>>(`/hr/leaves${toQuery({ page, status })}`);
  const { error, act } = useAction(list.reload);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ l: Leave; status: 'APPROVED' | 'REJECTED' | 'CANCELLED' } | null>(null);
  return (
    <>
      <PageHeader title="Férias e ausências" actions={can('hr.create') && <Button onClick={() => setCreating(true)}>Novo pedido</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todos os estados</option>
          {Object.entries(LEAVE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <Alert>{error || list.error}</Alert>
      <Card>
        <Table head={['Trabalhador', 'Tipo', 'Período', 'Dias úteis', 'Motivo', 'Documento', 'Estado', '']} empty={list.data?.items.length === 0}>
          {list.data?.items.map((l) => (
            <tr key={l.id}>
              <Td><Link className="font-medium text-brand-600 hover:underline" to={`/rh/trabalhadores/${l.employee!.id}`}>{l.employee!.name}</Link></Td>
              <Td>{LEAVE_TYPES[l.type]}</Td><Td className="whitespace-nowrap">{formatDate(l.startDate)} → {formatDate(l.endDate)}</Td><Td className="text-center">{l.days}</Td>
              <Td className="max-w-56 truncate">{l.reason ?? '-'}{l.comment && <div className="text-xs text-slate-500">{l.comment}</div>}</Td>
              <Td><LeaveFile l={l} onChanged={list.reload} /></Td>
              <Td><Badge tone={statusTone(l.status)}>{LEAVE_STATUS[l.status]}</Badge></Td>
              <Td className="whitespace-nowrap">
                {can('hr.approve') && l.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <Button className="min-h-8 px-3 py-1" onClick={() => act(`/hr/leaves/${l.id}/decision`, 'POST', { status: 'APPROVED' })}>Aprovar</Button>
                    <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setDeciding({ l, status: 'REJECTED' })}>Rejeitar</Button>
                  </div>
                )}
                {can('hr.approve') && l.status === 'APPROVED' && <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setDeciding({ l, status: 'CANCELLED' })}>Cancelar</Button>}
              </Td>
            </tr>
          ))}
        </Table>
        {list.data && <Pagination {...list.data} onPage={setPage} />}
      </Card>
      {creating && <LeaveForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />}
      {deciding && (
        <ConfirmModal danger title={deciding.status === 'REJECTED' ? 'Rejeitar pedido' : 'Cancelar férias aprovadas'} label="Comentário" required={deciding.status === 'REJECTED'}
          message={deciding.status === 'CANCELLED' ? 'Os dias marcados na assiduidade são removidos.' : undefined} onClose={() => setDeciding(null)}
          onConfirm={async (comment) => { await api(`/hr/leaves/${deciding.l.id}/decision`, { method: 'POST', body: { status: deciding.status, comment } }); list.reload(); }} />
      )}
    </>
  );
}

// ── Salários ──

export function PayrollList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const runs = useApi<Run[]>('/hr/payroll');
  const [period, setPeriod] = useState(thisMonth());
  const [error, setError] = useState('');
  const generate = async () => {
    setError('');
    try {
      navigate(`/rh/salarios/${(await api<{ id: string }>('/hr/payroll', { method: 'POST', body: { period } })).id}`);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <>
      <PageHeader title="Folhas de salário" actions={can('hr.edit') && (
        <div className="flex items-end gap-2">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Mês" className="w-44" />
          <Button onClick={generate} className="whitespace-nowrap">Processar mês</Button>
        </div>
      )} />
      <p className="mb-4 text-sm text-slate-500">O processamento usa a ficha de cada trabalhador, as faltas e horas extra da assiduidade e a produção à peça dos operadores ligados. Regras de INSS e IRT no backoffice (Configurações).</p>
      <Alert>{error || runs.error}</Alert>
      <Card>
        <Table head={['Mês', 'Trabalhadores', 'Ilíquido', 'INSS (total)', 'IRT', 'Líquido', 'Pago', 'Custo empresa', 'Estado']} empty={runs.data?.length === 0}>
          {runs.data?.map((r) => (
            <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/rh/salarios/${r.id}`)}>
              <Td className="font-medium">{r.period}</Td><Td className="text-center">{r.count}</Td><Td className="text-right">{formatKz(r.gross)}</Td><Td className="text-right">{formatKz(r.inss)}</Td>
              <Td className="text-right">{formatKz(r.irt)}</Td><Td className="text-right font-medium">{formatKz(r.net)}</Td><Td className="text-right">{formatKz(r.paid)}</Td><Td className="text-right">{formatKz(r.employerCost)}</Td>
              <Td><Badge tone={statusTone(r.status)}>{PAYROLL_STATUS[r.status]}</Badge></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export function PayrollDetail() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const res = useApi<{ id: string; period: string; status: keyof typeof PAYROLL_STATUS; payslips: Slip[]; totals: Totals }>(`/hr/payroll/${id}`);
  const { error, act } = useAction(res.reload);
  const [editing, setEditing] = useState<Slip | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [history, setHistory] = useState<Slip | null>(null);
  const r = res.data;
  if (res.error) return <Alert>{res.error}</Alert>;
  if (!r) return <div className="text-slate-500">A carregar…</div>;
  const draft = r.status === 'DRAFT';
  const payable = can('hr.approve') && ['APPROVED', 'PARTIAL'].includes(r.status);
  const unpaid = r.payslips.filter((p) => p.paid < p.net);
  const departments = [...new Set(unpaid.map((p) => p.employee.department || 'Sem departamento'))].sort();
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const reload = () => { setSelected([]); res.reload(); };
  return (
    <>
      <PageHeader title={`Folha de salários ${r.period}`} actions={
        <div className="flex flex-wrap gap-2">
          {can('hr.edit') && draft && <Button variant="secondary" onClick={() => act('/hr/payroll', 'POST', { period: r.period })}>Recalcular</Button>}
          {can('hr.export') && <Button variant="secondary" onClick={() => openFile(`/hr/payroll/${r.id}/pdf`)}>Recibos (PDF)</Button>}
          {can('hr.approve') && draft && <Button onClick={() => act(`/hr/payroll/${r.id}/status`, 'POST', { status: 'APPROVED' })}>Aprovar</Button>}
          {can('hr.approve') && r.status === 'APPROVED' && <Button variant="secondary" onClick={() => act(`/hr/payroll/${r.id}/status`, 'POST', { status: 'DRAFT' })}>Reabrir</Button>}

        </div>
      } />
      <div className="mb-4"><Alert>{error}</Alert></div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Card className="p-4"><div className="text-xs text-slate-500">Estado</div><Badge tone={statusTone(r.status)}>{PAYROLL_STATUS[r.status]}</Badge></Card>
        {([['Ilíquido', r.totals.gross], ['INSS (3% + 8%)', r.totals.inss], ['IRT', r.totals.irt], ['Líquido a pagar', r.totals.net], ['Pago', r.totals.paid], ['Em falta', r.totals.net - r.totals.paid], ['Custo empresa', r.totals.employerCost]] as const).map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{formatKz(v)}</div></Card>
        ))}
      </div>
      {payable && unpaid.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="font-medium">Pagamento:</span>
          <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setSelected(unpaid.map((p) => p.id))}>Todos por pagar ({unpaid.length})</Button>
          <Select className="w-56" value="" onChange={(e) => setSelected(unpaid.filter((p) => (p.employee.department || 'Sem departamento') === e.target.value).map((p) => p.id))}>
            <option value="">Seleccionar departamento…</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          {selected.length > 0 && <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setSelected([])}>Limpar</Button>}
          <Button className="ml-auto" disabled={!selected.length} onClick={() => setPaying(true)}>Pagar seleccionados ({selected.length})</Button>
        </Card>
      )}
      <Card className="[&_td]:whitespace-nowrap">
        <Table head={[...(payable ? [''] : []), 'Trabalhador', 'Base', 'Subsídios', 'Extra', 'Peça', 'Prémios', 'Faltas', 'Ilíquido', 'INSS', 'IRT', 'Outros desc.', 'Líquido', 'Pago', '']} empty={!r.payslips.length}>
          {r.payslips.map((p) => (
            <tr key={p.id}>
              {payable && <Td>{p.paid < p.net && <input type="checkbox" aria-label={`Seleccionar ${p.employee.name}`} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />}</Td>}
              <Td><Link className="font-medium text-brand-600 hover:underline" to={`/rh/trabalhadores/${p.employee.id}`}>{p.employee.name}</Link><div className="text-xs text-slate-500">{[p.employee.position, p.employee.department].filter(Boolean).join(' · ')}</div></Td>
              <Td className="text-right">{formatKz(p.baseSalary)}</Td><Td className="text-right">{formatKz(p.mealAllowance + p.transportAllowance + p.otherAllowances)}</Td>
              <Td className="text-right">{p.overtimePay ? formatKz(p.overtimePay) : '-'}</Td><Td className="text-right">{p.piecePay ? formatKz(p.piecePay) : '-'}</Td><Td className="text-right">{p.bonus ? formatKz(p.bonus) : '-'}</Td>
              <Td className="text-right text-red-700">{p.absenceDeduction ? `-${formatKz(p.absenceDeduction)}` : '-'}</Td>
              <Td className="text-right">{formatKz(p.gross)}</Td><Td className="text-right">{formatKz(p.inssEmployee)}</Td><Td className="text-right">{formatKz(p.irt)}</Td><Td className="text-right">{p.otherDeductions ? formatKz(p.otherDeductions) : '-'}</Td>
              <Td className="text-right font-semibold">{formatKz(p.net)}</Td>
              <Td className="text-right">
                {p.payments?.length ? <button className={`cursor-pointer hover:underline ${p.paid >= p.net ? 'text-green-700' : 'text-amber-700'}`} onClick={() => setHistory(p)}>{formatKz(p.paid)}</button> : '-'}
              </Td>
              <Td className="whitespace-nowrap">
                {can('hr.edit') && draft && <button className="mr-3 cursor-pointer text-brand-600 hover:underline" onClick={() => setEditing(p)}>Ajustar</button>}
                {can('hr.export') && <button className="cursor-pointer text-brand-600 hover:underline" onClick={() => openFile(`/hr/payroll/${r.id}/pdf?employeeId=${p.employeeId}`)}>PDF</button>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {editing && <SlipForm slip={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload(); }} />}
      {paying && <PaySalaries runId={r.id} slips={r.payslips.filter((p) => selected.includes(p.id))} onClose={() => setPaying(false)} onPaid={() => { setPaying(false); reload(); }} />}
      {history && <SlipPayments slip={r.payslips.find((p) => p.id === history.id) ?? history} canCancel={can('hr.approve')} onClose={() => setHistory(null)} onChanged={reload} />}
    </>
  );
}

/** Pagamento de vários recibos: % do líquido (ex.: 50% agora) ou valor fixo para um só trabalhador. */
function PaySalaries({ runId, slips, onClose, onPaid }: { runId: string; slips: Slip[]; onClose: () => void; onPaid: () => void }) {
  const [f, setF] = useState({ percent: 100, amount: '', method: 'TRANSFER', paidAt: localDate(), reference: '' });
  const [error, setError] = useState('');
  const single = slips.length === 1;
  const amount = single && f.amount ? Number(f.amount) : undefined;
  const total = slips.reduce((s, p) => s + salaryInstalment(p.net, p.paid, f.percent, amount), 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/hr/payroll/${runId}/payments`, { method: 'POST', body: { payslipIds: slips.map((p) => p.id), percent: f.percent, amount: amount ?? null, method: f.method, paidAt: f.paidAt, reference: f.reference } });
      onPaid();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={`Pagar salários - ${slips.length} trabalhador(es)`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="% do líquido de cada um"><Input type="number" min={1} max={100} step={1} disabled={!!amount} value={f.percent} onChange={(e) => setF({ ...f, percent: Number(e.target.value) })} /></Field>
          {single && <Field label="ou valor fixo (Kz)"><Input type="number" min={1} step={1} placeholder={String(slips[0].net - slips[0].paid)} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
          <Field label="Método"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Data"><Input type="date" required value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Referência"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="ex.: lote de transferências BAI" /></Field></div>
        </div>
        <p className="text-sm text-slate-600">Nunca é pago mais do que falta a cada trabalhador. Cada pagamento é lançado como despesa "Salários".</p>
        <div className="flex items-center justify-between">
          <span className="text-sm">Total a pagar: <b>{formatKz(total)}</b></span>
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!total}>Confirmar pagamento</Button></div>
        </div>
      </form>
    </Modal>
  );
}

function SlipPayments({ slip, canCancel, onClose, onChanged }: { slip: Slip; canCancel: boolean; onClose: () => void; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  return (
    <Modal open title={`Pagamentos - ${slip.employee.name}`} onClose={onClose}>
      <p className="mb-2 text-sm">Líquido {formatKz(slip.net)} · pago {formatKz(slip.paid)} · <b>em falta {formatKz(slip.net - slip.paid)}</b></p>
      <ul className="divide-y divide-slate-100 text-sm">
        {slip.payments?.map((p) => (
          <li key={p.id} className={`flex items-center justify-between py-1.5 ${p.cancelledAt ? 'text-slate-400 line-through' : ''}`}>
            <span>{formatDate(p.paidAt)} · {PAYMENT_METHODS[p.method]}{p.reference && ` · ${p.reference}`}</span>
            <span className="flex items-center gap-3">{formatKz(p.amount)}{!p.cancelledAt && canCancel && <button className="cursor-pointer text-xs text-red-600 hover:underline" onClick={() => setCancelling(p.id)}>Anular</button>}</span>
          </li>
        ))}
      </ul>
      {cancelling && <ConfirmModal danger title="Anular pagamento" message="O valor volta a ficar em falta e a despesa correspondente é removida." onClose={() => setCancelling(null)}
        onConfirm={async () => { await api(`/hr/salary-payments/${cancelling}/cancel`, { method: 'POST' }); onChanged(); onClose(); }} />}
    </Modal>
  );
}

function SlipForm({ slip, onClose, onSaved }: { slip: Slip; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ bonus: slip.bonus, otherDeductions: slip.otherDeductions, notes: slip.notes ?? '' });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/hr/payslips/${slip.id}`, { method: 'PATCH', body: f });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal open title={`Ajustar recibo - ${slip.employee.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Prémios (Kz)"><Input type="number" min={0} step={1} value={f.bonus} onChange={(e) => setF({ ...f, bonus: Number(e.target.value) })} /></Field>
          <Field label="Outros descontos (Kz)"><Input type="number" min={0} step={1} value={f.otherDeductions} onChange={(e) => setF({ ...f, otherDeductions: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Notas (aparecem no recibo)"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">Base, subsídios, faltas e horas extra vêm da ficha e da assiduidade: altere-os lá e use "Recalcular".</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}
