import { ACTIONS, MODULES, type ActionKey, type ModuleKey } from '@ivamarg/shared';

/** Grelha módulo × acção. `locked` = permissões já dadas pelo perfil (mostradas marcadas e bloqueadas). */
export function PermissionGrid({ value, onChange, disabled, locked = [] }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; locked?: string[] }) {
  const toggle = (p: string) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="py-2 text-left font-medium">Módulo</th>
            {Object.values(ACTIONS).map((a) => <th key={a} className="px-2 py-2 font-medium whitespace-nowrap">{a}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(Object.keys(MODULES) as ModuleKey[]).map((m) => (
            <tr key={m}>
              <td className="py-2 pr-4">{MODULES[m]}</td>
              {(Object.keys(ACTIONS) as ActionKey[]).map((a) => {
                const p = `${m}.${a}`;
                const fromRole = locked.includes(p);
                return (
                  <td key={a} className="px-2 py-2 text-center">
                    <input type="checkbox" aria-label={`${MODULES[m]} - ${ACTIONS[a]}`} disabled={disabled || fromRole} checked={fromRole || value.includes(p)} onChange={() => toggle(p)} title={fromRole ? 'Dada pelo perfil' : undefined} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
