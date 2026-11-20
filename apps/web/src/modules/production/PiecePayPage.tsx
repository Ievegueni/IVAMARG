import { formatKz, PAY_MODEL } from '@ivamarg/shared';
import { Fragment, useState } from 'react';
import { Alert, Card, Field, Input, PageHeader, Table, Td } from '../../components/ui';
import { toQuery } from '../../lib/api';
import { localDate, monthStartDate } from '../../lib/format';
import { useApi } from '../../lib/useApi';

type Row = { operatorId: string; name: string; code: string; section: string | null; payModel: keyof typeof PAY_MODEL; pieces: number; rejected: number; pieceAmount: number; fixed: number; total: number; byStage: { stage: string; pieces: number; amount: number }[] };


/** Pagamento à peça por operador num período (dias em hora de Luanda). */
export function PiecePayPage() {
  const [f, setF] = useState({ from: monthStartDate(), to: localDate() });
  const rows = useApi<Row[]>(`/production/piece-pay${toQuery({ from: `${f.from}T00:00:00+01:00`, to: `${f.to}T23:59:59.999+01:00` })}`);
  const [open, setOpen] = useState<string>();
  const total = rows.data?.reduce((s, r) => s + r.total, 0) ?? 0;
  return (
    <>
      <PageHeader title="Pagamento à peça" />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="De"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Até"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </div>
      <Alert>{rows.error}</Alert>
      <Card>
        <Table head={['Operador', 'Secção', 'Modelo', 'Peças', 'Rejeitadas', 'À peça', 'Fixo', 'Total']} empty={rows.data?.length === 0}>
          {rows.data?.map((r) => (
            <Fragment key={r.operatorId}>
              <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === r.operatorId ? undefined : r.operatorId)}>
                <Td className="font-medium">{r.name} <span className="font-mono text-xs text-slate-400">{r.code}</span></Td>
                <Td>{r.section ?? '-'}</Td><Td>{PAY_MODEL[r.payModel]}</Td>
                <Td className="text-right">{r.pieces}</Td><Td className="text-right">{r.rejected || '-'}</Td>
                <Td className="text-right">{formatKz(r.pieceAmount)}</Td><Td className="text-right">{r.fixed ? formatKz(r.fixed) : '-'}</Td>
                <Td className="text-right font-semibold">{formatKz(r.total)}</Td>
              </tr>
              {open === r.operatorId && r.byStage.map((s) => (
                <tr key={s.stage} className="bg-slate-50 text-xs text-slate-600"><td /><td colSpan={2} className="px-4 py-1">{s.stage}</td><td className="px-4 py-1 text-right">{s.pieces}</td><td /><td className="px-4 py-1 text-right">{formatKz(s.amount)}</td><td colSpan={2} /></tr>
              ))}
            </Fragment>
          ))}
        </Table>
        <div className="flex justify-end border-t border-slate-200 px-4 py-3 text-sm">Total do período: <b className="ml-2">{formatKz(total)}</b></div>
      </Card>
      <p className="mt-3 text-xs text-slate-500">O fixo mensal é mostrado por inteiro para o período; ajuste proporcionalmente se o período não for um mês completo.</p>
    </>
  );
}
