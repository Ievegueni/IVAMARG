// Permissões = `${módulo}.${acção}`. Guardadas em Role.permissions (editável no backoffice).
export const MODULES = {
  admin: 'Administração (utilizadores, perfis, auditoria)',
  backoffice: 'Backoffice (configurações)',
  clients: 'Clientes',
  pipeline: 'Pipeline / propostas',
  production: 'Produção',
  stock: 'Stock',
  operations: 'Operações (obras, limpeza, furos)',
  documents: 'Documentos',
  tasks: 'Tarefas e agenda',
  communication: 'Comunicação',
  finance: 'Financeiro',
  reports: 'Relatórios / KPIs',
  hr: 'Recursos humanos (pessoal, assiduidade, férias, salários)',
} as const;

export const ACTIONS = {
  view: 'Ver',
  viewAll: 'Ver todos', // sem isto, só vê os registos de que é responsável (carteira)
  create: 'Criar',
  edit: 'Editar',
  delete: 'Eliminar',
  approve: 'Aprovar',
  export: 'Exportar',
} as const;

export type ModuleKey = keyof typeof MODULES;
export type ActionKey = keyof typeof ACTIONS;
export type Permission = `${ModuleKey}.${ActionKey}`;

export const ALL_PERMISSIONS = Object.keys(MODULES).flatMap((m) =>
  Object.keys(ACTIONS).map((a) => `${m}.${a}` as Permission),
);

const all = (m: ModuleKey) => Object.keys(ACTIONS).map((a) => `${m}.${a}` as Permission);
const only = (m: ModuleKey, ...actions: ActionKey[]) => actions.map((a) => `${m}.${a}` as Permission);

// Perfis default (CLAUDE.md §7). "carteira" / "os seus" = `view` sem `viewAll`.
export const DEFAULT_ROLES: { name: string; isAdmin?: boolean; permissions: Permission[] }[] = [
  { name: 'Administrador', isAdmin: true, permissions: ALL_PERMISSIONS },
  {
    name: 'Gestor',
    permissions: [
      ...only('admin', 'view', 'viewAll'),
      ...only('backoffice', 'view', 'viewAll'),
      ...all('clients'),
      ...all('pipeline'),
      ...all('production'),
      ...all('stock'),
      ...all('documents'),
      ...all('communication'),
      ...all('finance'),
      ...all('reports'),
      ...all('tasks'),
      ...all('operations'),
      ...all('hr'),
    ],
  },
  {
    name: 'Comercial',
    permissions: [
      ...only('clients', 'view', 'create', 'edit'),
      ...only('pipeline', 'view', 'create', 'edit'),
      ...only('production', 'view', 'viewAll'),
      ...only('stock', 'view', 'viewAll'),
      ...only('documents', 'view', 'create'),
      ...only('communication', 'view', 'create'),
      ...only('finance', 'view'),
      ...only('reports', 'view'),
      ...only('tasks', 'view', 'create', 'edit'),
      ...only('operations', 'view', 'viewAll'),
    ],
  },
  {
    name: 'Produção/Stock',
    permissions: [
      ...only('clients', 'view', 'viewAll'),
      ...all('production'),
      ...all('stock'),
      ...only('documents', 'view', 'viewAll', 'create'),
      ...only('reports', 'view'),
      ...only('tasks', 'view', 'create', 'edit'),
      ...only('operations', 'view', 'viewAll', 'create', 'edit'),
    ],
  },
  {
    name: 'Financeiro',
    permissions: [
      ...only('clients', 'view', 'viewAll'),
      ...only('pipeline', 'view', 'viewAll'),
      ...only('production', 'view', 'viewAll'),
      ...only('stock', 'view', 'viewAll'),
      ...only('documents', 'view', 'viewAll', 'create'),
      ...only('communication', 'view', 'create'),
      ...all('finance'),
      ...only('hr', 'view', 'viewAll', 'export'),
      ...only('reports', 'view', 'viewAll', 'export'),
      ...only('tasks', 'view', 'create', 'edit'),
      ...only('operations', 'view', 'viewAll'),
    ],
  },
];

export function hasPermission(user: { isAdmin?: boolean; permissions: readonly string[] }, p: Permission) {
  return !!user.isAdmin || user.permissions.includes(p);
}
