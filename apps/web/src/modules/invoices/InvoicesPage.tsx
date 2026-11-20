import { formatDate, formatDateTime, formatKz, INVOICE_STATUS } from '@ivamarg/shared';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, Pagination, Select, Table, Td } from '../../components/ui';
import { api, openFile, toQuery } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useApi, type Page } from '../../lib/useApi';

type Invoice = { id: string; status: keyof typeof INVOICE_STATUS; number: string | null; total: number; clientName?: string; issuedAt: string | null; createdAt: string; dueDate: string | null; error: string | null; documentType: string };
const tone = (s: Invoice['status']) => (s === 'ISSUED' ? 'green' : s === 'FAILED' ? 'red' : s === 'PENDING' ? 'amber' : 'slate');

export function InvoicesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const list = useApi<Page<Invoice>>(`/invoices${toQuery({ page, status })}`);
  return (
    <>
      <PageHeader title="Facturas (Vendus)" />
      <p className="mb-4 text-sm text-slate-500">As facturas são emitidas no Vendus a partir de encomendas prontas, propostas aceites ou contratos. Use o botão "Emitir factura" nessas fichas.</p>
      <Select className="mb-4 max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">Todos os estados</option>
        {Object.entries(INVOICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <Alert>{list.error}</Alert>
      <Card><InvoiceTable items={list.data?.items} reload={list.reload} />{list.data && <Pagination {...list.data} onPage={setPage} />}</Card>
    </>
  );
}

export function InvoiceTable({ items, reload }: { items?: Invoice[]; reload: () => void }) {
  const { can } = useAuth();
  const [error, setError] = useState('');
  return (
    <>
      <div className="px-4 pt-2"><Alert>{error}</Alert></div>
      <Table head={['Número', 'Cliente', 'Total', 'Vencimento', 'Estado', '']} empty={items?.length === 0}>
        {items?.map((i) => (
          <tr key={i.id}>
            <Td className="font-medium">{i.number ?? '-'}<div className="text-xs text-slate-400">{formatDateTime(i.issuedAt ?? i.createdAt)}</div></Td>
            <Td>{i.clientName ?? '-'}</Td>
            <Td className="text-right">{formatKz(i.total)}</Td>
            <Td>{i.dueDate ? formatDate(i.dueDate) : '-'}</Td>
            <Td><Badge tone={tone(i.status)}>{INVOICE_STATUS[i.status]}</Badge>{i.error && <div className="mt-1 max-w-xs text-xs text-red-600">{i.error}</div>}</Td>
            <Td className="space-x-3 text-right whitespace-nowrap">
              {i.status === 'ISSUED' && <button className="text-brand-600 hover:underline" onClick={() => openFile(`/invoices/${i.id}/pdf`).catch((e) => setError(errMsg(e)))}>PDF</button>}
              {i.status === 'FAILED' && can('finance.create') && <button className="text-brand-600 hover:underline" onClick={() => api(`/invoices/${i.id}/retry`, { method: 'POST' }).then(reload).catch((e) => setError(errMsg(e)))}>Reenviar</button>}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/** Botão "Emitir factura" para encomenda / proposta / contrato. */
export function IssueInvoiceButton({ source, sourceId, label, onDone }: { source: 'Order' | 'Proposal' | 'Contract'; sourceId: string; label: string; onDone?: () => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  if (!can('finance.create')) return null;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Emitir factura</Button>
      {msg && <span className={`text-xs ${msg.tone === 'error' ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</span>}
      {open && (
        <ConfirmModal
          title={`Emitir factura - ${label}`}
          message={<div className="space-y-3"><p>A factura é enviada para o Vendus em segundo plano; o número fica disponível quando for emitida.</p><Field label="Data de vencimento (opcional)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field></div>}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            try {
              await api('/invoices', { method: 'POST', body: { source, sourceId, dueDate: due || null } });
              setMsg({ tone: 'success', text: 'Factura em emissão.' });
              onDone?.();
            } catch (e) {
              setMsg({ tone: 'error', text: errMsg(e) });
            }
          }}
        />
      )}
    </>
  );
}
