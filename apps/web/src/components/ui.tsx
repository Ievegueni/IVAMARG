import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import React, { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  );
}

// text-base no telemóvel (16 px evita o zoom automático do iOS), text-sm a partir de sm.
const inputCls = 'min-h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm transition-colors duration-200 placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-600 focus:ring-4 focus:ring-brand-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 sm:text-sm';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[13px] font-medium text-slate-600">{label}</span>
      {children}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)]', className)}>{children}</div>
);

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {actions}
    </div>
  );
}

export const Alert = ({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' }) =>
  children ? (
    <div
      className={cx(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'success' && 'border-green-200 bg-green-50 text-green-800',
        tone === 'info' && 'border-blue-200 bg-brand-50 text-brand-700',
      )}
    >
      {children}
    </div>
  ) : null;

export const Badge = ({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' }) => (
  <span
    className={cx(
      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
      tone === 'slate' && 'bg-slate-50 text-slate-700 ring-slate-200',
      tone === 'green' && 'bg-green-50 text-green-700 ring-green-600/20',
      tone === 'red' && 'bg-red-50 text-red-700 ring-red-600/20',
      tone === 'amber' && 'bg-amber-50 text-amber-800 ring-amber-600/20',
    )}
  >
    {children}
  </span>
);

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          <tr>{head.map((h, i) => <th key={i} className="px-4 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr]:transition-colors [&>tr]:duration-150 [&>tr:hover]:bg-slate-50/70">
          {empty ? (
            <tr><td colSpan={head.length} className="px-4 py-10 text-center text-sm text-slate-500">Sem registos.</td></tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('px-4 py-3 text-slate-700', className)}>{children}</td>
);

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <span>{total} registo(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <span>{page} / {pages}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Seguinte</Button>
      </div>
    </div>
  );
}

/** Renderizado em portal: pode ser aberto dentro de um <form> sem criar formulários aninhados no DOM. */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose} onSubmit={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="-mr-2 cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(inputCls, p.className)} />;

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: [T, string][] }) {
  return (
    <div className="no-scrollbar mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1" role="tablist">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cx('cursor-pointer rounded-md px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-200', value === k ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Formulário de confirmação com campo de texto opcional/obrigatório (substitui prompt/confirm do browser). */
export function ConfirmModal({ title, message, label, required, danger, onConfirm, onClose }: {
  title: string; message?: ReactNode; label?: string; required?: boolean; danger?: boolean;
  onConfirm: (text: string) => Promise<void> | void; onClose: () => void;
}) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // eventos React atravessam o portal: não submeter o formulário da página
    setBusy(true);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {message && <div className="text-sm text-slate-600">{message}</div>}
        {label && <Field label={label}><Textarea required={required} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>Confirmar</Button>
        </div>
      </form>
    </Modal>
  );
}
