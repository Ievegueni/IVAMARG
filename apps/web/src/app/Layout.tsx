import type { Permission } from '@ivamarg/shared';
import {
  IdCard,
  BarChart3, Briefcase, ChevronDown, ChevronsLeft, ChevronsRight, Factory, HardHat, Home, LogOut, Menu, MessagesSquare, Package, Settings, ShieldCheck, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { NotificationBell } from '../components/NotificationBell';
import { CallBar } from '../modules/communication/calls';
import { useAuth } from './auth';

type Item = { to: string; label: string; perm?: Permission };
type Group = { key: string; label: string; icon: LucideIcon; to?: string; items?: Item[] };

// Categorias do menu; as subcategorias só aparecem ao abrir a categoria.
const NAV: Group[] = [
  { key: 'home', label: 'Início', icon: Home, to: '/' },
  {
    key: 'work', label: 'Trabalho diário', icon: MessagesSquare,
    items: [
      { to: '/comunicacao', label: 'Caixa de entrada', perm: 'communication.view' },
      { to: '/tarefas', label: 'Tarefas', perm: 'tasks.view' },
      { to: '/agenda', label: 'Agenda', perm: 'tasks.view' },
      { to: '/documentos', label: 'Documentos', perm: 'documents.view' },
    ],
  },
  {
    key: 'sales', label: 'Comercial', icon: Briefcase,
    items: [
      { to: '/clientes', label: 'Clientes', perm: 'clients.view' },
      { to: '/pipeline', label: 'Pipeline', perm: 'pipeline.view' },
      { to: '/propostas', label: 'Propostas', perm: 'pipeline.view' },
      { to: '/contratos', label: 'Contratos', perm: 'pipeline.view' },
    ],
  },
  {
    key: 'production', label: 'Produção', icon: Factory,
    items: [
      { to: '/encomendas', label: 'Encomendas', perm: 'production.view' },
      { to: '/producao/ops', label: 'Ordens de produção', perm: 'production.view' },
      { to: '/catalogo', label: 'Catálogo / fichas técnicas', perm: 'production.view' },
      { to: '/producao/pagamentos', label: 'Pagamento à peça', perm: 'production.approve' },
      { to: '/producao/configuracao', label: 'Configuração', perm: 'production.view' },
      { to: '/chao', label: 'Chão de fábrica', perm: 'production.view' },
    ],
  },
  {
    key: 'ops', label: 'Operações', icon: HardHat,
    items: [
      { to: '/obras', label: 'Obras', perm: 'operations.view' },
      { to: '/furos', label: 'Furos de água', perm: 'operations.view' },
      { to: '/limpeza', label: 'Limpeza e jardinagem', perm: 'operations.view' },
    ],
  },
  {
    key: 'stock', label: 'Stock', icon: Package,
    items: [
      { to: '/stock', label: 'Artigos', perm: 'stock.view' },
      { to: '/stock/movimentos', label: 'Movimentos', perm: 'stock.view' },
      { to: '/stock/compras', label: 'Compras', perm: 'stock.view' },
      { to: '/stock/fornecedores', label: 'Fornecedores', perm: 'stock.view' },
      { to: '/stock/inventarios', label: 'Inventários', perm: 'stock.view' },
    ],
  },
  {
    key: 'finance', label: 'Financeiro', icon: Wallet,
    items: [
      { to: '/financeiro', label: 'Financeiro', perm: 'finance.view' },
      { to: '/facturas', label: 'Facturas', perm: 'finance.view' },
    ],
  },
  {
    key: 'hr', label: 'Recursos humanos', icon: IdCard,
    items: [
      { to: '/rh/trabalhadores', label: 'Trabalhadores', perm: 'hr.view' },
      { to: '/rh/assiduidade', label: 'Assiduidade', perm: 'hr.view' },
      { to: '/rh/ferias', label: 'Férias e ausências', perm: 'hr.view' },
      { to: '/rh/salarios', label: 'Folhas de salário', perm: 'hr.view' },
    ],
  },
  { key: 'reports', label: 'Relatórios e KPIs', icon: BarChart3, items: [{ to: '/relatorios', label: 'Relatórios e KPIs', perm: 'reports.view' }] },
  {
    key: 'admin', label: 'Administração', icon: ShieldCheck,
    items: [
      { to: '/utilizadores', label: 'Utilizadores', perm: 'admin.view' },
      { to: '/perfis', label: 'Perfis e permissões', perm: 'admin.view' },
      { to: '/auditoria', label: 'Auditoria', perm: 'admin.view' },
    ],
  },
  {
    key: 'backoffice', label: 'Backoffice', icon: Settings,
    items: [
      { to: '/backoffice/linhas-negocio', label: 'Linhas de negócio', perm: 'backoffice.view' },
      { to: '/backoffice/configuracoes', label: 'Configurações', perm: 'backoffice.view' },
      { to: '/backoffice/documentos', label: 'Categorias de documentos', perm: 'backoffice.view' },
      { to: '/backoffice/comunicacao', label: 'Modelos e automações', perm: 'backoffice.view' },
      { to: '/backoffice/financeiro', label: 'Comissões e KPIs', perm: 'backoffice.view' },
    ],
  },
];

const KEY = 'ivamarg.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const matches = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

function Sidebar({ collapsed, onToggle, onNavigate, bell = true }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; bell?: boolean }) {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const groups = NAV.map((g) => ({ ...g, items: g.items?.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.to || g.items?.length);
  // Categoria aberta: a da página actual, ou a que o utilizador abriu (só uma de cada vez).
  // Subcategoria activa = a de caminho mais longo que corresponde (ex.: /stock/compras/123 → Compras, não Artigos).
  const activeTo = groups.flatMap((g) => g.items ?? []).filter((i) => matches(pathname, i.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const current = groups.find((g) => g.items?.some((i) => i.to === activeTo))?.key;
  const [open, setOpen] = useState<string | undefined>(current);
  useEffect(() => setOpen(current), [current]);

  const linkCls = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 cursor-pointer ${active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`;

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className={`flex h-14 shrink-0 items-center border-b border-white/5 ${collapsed ? 'justify-center' : 'justify-between px-4'}`}>
        {collapsed ? (
          <span title={user?.name} className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">{user?.name[0]}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold">{user?.name[0]}</span>
            <span className="truncate">{user?.name}</span>
          </span>
        )}
        {!collapsed && bell && <NotificationBell />}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Menu principal">
        {groups.map((g) => {
          const Icon = g.icon;
          const active = g.to ? matches(pathname, g.to) : g.key === current;
          // Categoria com um só item: liga directamente.
          const direct = g.to ?? (g.items!.length === 1 ? g.items![0].to : undefined);
          if (direct) {
            return (
              <NavLink key={g.key} to={direct} end={direct === '/'} onClick={onNavigate} title={collapsed ? g.label : undefined} className={linkCls(active) + (collapsed ? ' justify-center' : '')}>
                <Icon size={18} className="shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{g.label}</span>}
              </NavLink>
            );
          }
          const isOpen = open === g.key && !collapsed;
          return (
            <div key={g.key}>
              <button
                type="button"
                title={collapsed ? g.label : undefined}
                aria-expanded={isOpen}
                onClick={() => (collapsed ? (onToggle?.(), setOpen(g.key)) : setOpen(isOpen ? undefined : g.key))}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 cursor-pointer ${collapsed ? 'justify-center' : ''} ${active ? 'text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'} ${active && collapsed ? 'bg-blue-600' : ''}`}
              >
                <Icon size={18} className={`shrink-0 ${active && !collapsed ? 'text-blue-400' : ''}`} aria-hidden />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{g.label}</span>
                    <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                  </>
                )}
              </button>
              {isOpen && (
                <div className="mt-1 mb-2 ml-5 space-y-0.5 border-l border-white/10 pl-3">
                  {g.items!.map((i) => (
                    <NavLink
                      key={i.to}
                      to={i.to}
                      onClick={onNavigate}
                      aria-current={i.to === activeTo ? 'page' : undefined}
                      className={`block rounded-md px-3 py-1.5 text-[13px] transition-colors duration-200 ${i.to === activeTo ? 'bg-blue-600 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    >
                      {i.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/5 p-2">
        {collapsed && bell && <div className="flex justify-center py-1"><NotificationBell align="side" /></div>}
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
              {user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{user?.name}</span>
              <span className="block truncate text-xs text-slate-400">{user?.role.name}</span>
            </span>
          </div>
        )}
        <button type="button" onClick={logout} title="Terminar sessão" className={`${linkCls(false)} w-full ${collapsed ? 'justify-center' : ''}`}>
          <LogOut size={18} aria-hidden />
          {!collapsed && 'Terminar sessão'}
        </button>
        {onToggle && (
          <button type="button" onClick={onToggle} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} className={`${linkCls(false)} w-full ${collapsed ? 'justify-center' : ''}`}>
            {collapsed ? <ChevronsRight size={18} aria-hidden /> : <ChevronsLeft size={18} aria-hidden />}
            {!collapsed && 'Recolher menu'}
          </button>
        )}
      </div>
    </div>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(KEY, c ? '0' : '1'); } catch { /* preferência não guardada */ }
      return !c;
    });
  };

  return (
    <div className="min-h-screen bg-brand">
      <CallBar />
      {/* Telemóvel/tablet: barra superior + gaveta */}
      <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between bg-slate-900 px-4 text-white lg:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu" className="-ml-2 rounded-lg p-2 hover:bg-white/10"><Menu size={22} /></button>
        <span className="truncate font-semibold">{user?.name}</span>
        <NotificationBell align="right" />
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" className="absolute top-3 -right-11 rounded-lg bg-slate-900 p-2 text-white"><X size={20} /></button>
            <Sidebar collapsed={false} bell={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      {/* Desktop: barra lateral fixa, recolhível */}
      <aside className={`fixed inset-y-0 left-0 z-20 hidden print:!hidden transition-[width] duration-200 lg:block ${collapsed ? 'w-16' : 'w-64'}`}>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>
      <main className={`min-w-0 p-4 transition-[padding] duration-200 sm:p-6 lg:p-8 print:p-0 ${collapsed ? 'lg:pl-24' : 'lg:pl-72'} print:lg:pl-0`}>
        <Outlet />
      </main>
    </div>
  );
}
