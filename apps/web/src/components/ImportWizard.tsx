import { useState, type ReactNode } from 'react';
import { readSheet } from 'read-excel-file/browser';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from './ui';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';

type Report = {
  created: number;
  summary: { total: number; ok: number; duplicate: number; error: number };
  rows: { row: number; status: 'ok' | 'error' | 'duplicate'; name?: string; errors: string[] }[];
};

/** CSV simples (separador , ou ;, aspas duplas). */
export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Assistente de importação Excel/CSV: pré-visualização no servidor (dryRun) e confirmação. */
export function ImportWizard({ title, endpoint, back, help, extraBody, children }: { title: string; endpoint: string; back: string; help: ReactNode; extraBody?: Record<string, unknown>; children?: ReactNode }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    setError(''); setReport(undefined);
    try {
      const matrix: unknown[][] = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : (await readSheet(file)) as unknown[][];
      const [header, ...body] = matrix;
      const objs = body.map((r) => Object.fromEntries(header.map((h, i) => [String(h ?? ''), r[i] ?? ''])));
      setRows(objs);
      setReport(await api<Report>(endpoint, { method: 'POST', body: { ...extraBody, rows: objs, dryRun: true } }));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      setReport(await api<Report>(endpoint, { method: 'POST', body: { ...extraBody, rows, dryRun: false } }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={title} actions={<Link to={back}><Button variant="secondary">Voltar</Button></Link>} />
      <Card className="mb-6 space-y-3 p-5 text-sm">
        {help}
        <p className="text-slate-500">Primeiro é mostrada a pré-visualização; nada é gravado até confirmar. Linhas com erro ou duplicadas são ignoradas.</p>
        {children}
        <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} className="text-sm" />
      </Card>
      <Alert>{error}</Alert>
      {report && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="space-x-3">
              <span>{report.summary.total} linhas</span>
              <Badge tone="green">{report.summary.ok} válidas</Badge>
              <Badge tone="amber">{report.summary.duplicate} duplicadas</Badge>
              <Badge tone="red">{report.summary.error} com erros</Badge>
            </div>
            {report.created ? (
              <Alert tone="success">{report.created} registo(s) importado(s).</Alert>
            ) : (
              <Button disabled={busy || !report.summary.ok} onClick={confirm}>Importar {report.summary.ok} registo(s)</Button>
            )}
          </div>
          <Table head={['Linha', 'Nome', 'Estado', 'Detalhe']}>
            {report.rows.map((r) => (
              <tr key={r.row}>
                <Td>{r.row}</Td>
                <Td>{r.name || '-'}</Td>
                <Td>{r.status === 'ok' ? <Badge tone="green">OK</Badge> : r.status === 'duplicate' ? <Badge tone="amber">Duplicado</Badge> : <Badge tone="red">Erro</Badge>}</Td>
                <Td className="text-slate-600">{r.errors.join(' · ')}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
