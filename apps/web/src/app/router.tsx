import type { Permission } from '@ivamarg/shared';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { AuditPage } from '../modules/admin/AuditPage';
import { RolesPage } from '../modules/admin/RolesPage';
import { UsersPage } from '../modules/admin/UsersPage';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from '../modules/auth/AuthPages';
import { BusinessLinesPage } from '../modules/backoffice/BusinessLinesPage';
import { SettingsPage } from '../modules/backoffice/SettingsPage';
import { ClientDetailPage } from '../modules/clients/ClientDetailPage';
import { ClientsPage } from '../modules/clients/ClientsPage';
import { ImportPage } from '../modules/clients/ImportPage';
import { ContractsPage } from '../modules/contracts/ContractsPage';
import { CatalogPage, ModelEditPage } from '../modules/catalog/CatalogPage';
import { FloorPage } from '../modules/floor/FloorPage';
import { CommsSettingsPage } from '../modules/communication/CommsSettingsPage';
import { InboxPage } from '../modules/communication/InboxPage';
import { HomePage } from '../modules/dashboard/Dashboards';
import { AttendancePage, EmployeeDetail, EmployeesList, LeavesPage, PayrollDetail, PayrollList } from '../modules/hr/HrPages';
import { CleaningPage } from '../modules/operations/CleaningPage';
import { OperationDetail, OperationsList } from '../modules/operations/OperationsPages';
import { FinancePage } from '../modules/finance/FinancePage';
import { FinanceSettingsPage } from '../modules/finance/FinanceSettingsPage';
import { ReportsPage } from '../modules/reports/ReportsPage';
import { DocumentSettingsPage } from '../modules/documents/DocumentSettings';
import { DocumentsPage } from '../modules/documents/DocumentsPage';
import { InvoicesPage } from '../modules/invoices/InvoicesPage';
import { AgendaPage } from '../modules/tasks/AgendaPage';
import { TasksPage } from '../modules/tasks/TasksPage';
import { PiecePayPage } from '../modules/production/PiecePayPage';
import { ProductionConfigPage } from '../modules/production/ProductionConfigPage';
import { ProductionOrderPage } from '../modules/production/ProductionOrderPage';
import { ProductionOrdersPage } from '../modules/production/ProductionOrdersPage';
import { ImportItemsPage } from '../modules/stock/ImportItemsPage';
import { InventoriesPage, InventoryDetailPage } from '../modules/stock/InventoriesPage';
import { MovementsPage } from '../modules/stock/MovementsPage';
import { PurchaseDetailPage, PurchasesPage } from '../modules/stock/PurchasesPage';
import { StockPage } from '../modules/stock/StockPage';
import { SuppliersPage } from '../modules/stock/SuppliersPage';
import { OrderDetailPage } from '../modules/orders/OrderDetailPage';
import { OrdersPage } from '../modules/orders/OrdersPage';
import { PipelinePage } from '../modules/pipeline/PipelinePage';
import { NewProposalPage } from '../modules/proposals/NewProposalPage';
import { ProposalDetailPage } from '../modules/proposals/ProposalDetailPage';
import { ProposalsPage } from '../modules/proposals/ProposalsPage';
import { useAuth } from './auth';
import { Layout } from './Layout';

function RequireAuth({ children, perm }: { children: ReactNode; perm?: Permission }) {
  const { user, ready, can } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="p-8 text-slate-500">A carregar…</div>;
  if (!user) return <Navigate to="/entrar" state={{ from: location.pathname }} replace />;
  if (perm && !can(perm)) return <div className="p-8 text-slate-600">Não tem permissão para aceder a esta página.</div>;
  return children;
}

export const router = createBrowserRouter([
  { path: '/entrar', element: <LoginPage /> },
  { path: '/recuperar-palavra-passe', element: <ForgotPasswordPage /> },
  { path: '/redefinir-palavra-passe', element: <ResetPasswordPage /> },
  { path: '/chao', element: <FloorPage /> }, // sessão própria do operador (PIN)
  {
    element: <RequireAuth><Layout /></RequireAuth>,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/clientes', element: <RequireAuth perm="clients.view"><ClientsPage /></RequireAuth> },
      { path: '/clientes/importar', element: <RequireAuth perm="clients.create"><ImportPage /></RequireAuth> },
      { path: '/clientes/:id', element: <RequireAuth perm="clients.view"><ClientDetailPage /></RequireAuth> },
      { path: '/pipeline', element: <RequireAuth perm="pipeline.view"><PipelinePage /></RequireAuth> },
      { path: '/propostas', element: <RequireAuth perm="pipeline.view"><ProposalsPage /></RequireAuth> },
      { path: '/propostas/nova', element: <RequireAuth perm="pipeline.create"><NewProposalPage /></RequireAuth> },
      { path: '/propostas/:id', element: <RequireAuth perm="pipeline.view"><ProposalDetailPage /></RequireAuth> },
      { path: '/contratos', element: <RequireAuth perm="pipeline.view"><ContractsPage /></RequireAuth> },
      { path: '/encomendas', element: <RequireAuth perm="production.view"><OrdersPage /></RequireAuth> },
      { path: '/encomendas/nova', element: <RequireAuth perm="production.create"><OrderDetailPage key="new" /></RequireAuth> },
      { path: '/encomendas/:id', element: <RequireAuth perm="production.view"><OrderDetailPage /></RequireAuth> },
      { path: '/producao/ops', element: <RequireAuth perm="production.view"><ProductionOrdersPage /></RequireAuth> },
      { path: '/producao/ops/:id', element: <RequireAuth perm="production.view"><ProductionOrderPage /></RequireAuth> },
      { path: '/producao/pagamentos', element: <RequireAuth><PiecePayPage /></RequireAuth> },
      { path: '/producao/configuracao', element: <RequireAuth perm="production.view"><ProductionConfigPage /></RequireAuth> },
      { path: '/catalogo', element: <RequireAuth perm="production.view"><CatalogPage /></RequireAuth> },
      { path: '/catalogo/novo', element: <RequireAuth perm="production.create"><ModelEditPage key="new" /></RequireAuth> },
      { path: '/catalogo/:id', element: <RequireAuth perm="production.view"><ModelEditPage /></RequireAuth> },
      { path: '/stock', element: <RequireAuth perm="stock.view"><StockPage /></RequireAuth> },
      { path: '/stock/importar', element: <RequireAuth perm="stock.create"><ImportItemsPage /></RequireAuth> },
      { path: '/stock/movimentos', element: <RequireAuth perm="stock.view"><MovementsPage /></RequireAuth> },
      { path: '/stock/compras', element: <RequireAuth perm="stock.view"><PurchasesPage /></RequireAuth> },
      { path: '/stock/compras/nova', element: <RequireAuth perm="stock.create"><PurchaseDetailPage key="new" /></RequireAuth> },
      { path: '/stock/compras/:id', element: <RequireAuth perm="stock.view"><PurchaseDetailPage /></RequireAuth> },
      { path: '/stock/fornecedores', element: <RequireAuth perm="stock.view"><SuppliersPage /></RequireAuth> },
      { path: '/stock/inventarios', element: <RequireAuth perm="stock.view"><InventoriesPage /></RequireAuth> },
      { path: '/stock/inventarios/:id', element: <RequireAuth perm="stock.view"><InventoryDetailPage /></RequireAuth> },
      { path: '/comunicacao', element: <RequireAuth perm="communication.view"><InboxPage /></RequireAuth> },
      { path: '/backoffice/comunicacao', element: <RequireAuth perm="backoffice.view"><CommsSettingsPage /></RequireAuth> },
      { path: '/financeiro', element: <RequireAuth perm="finance.view"><FinancePage /></RequireAuth> },
      { path: '/relatorios', element: <RequireAuth perm="reports.view"><ReportsPage /></RequireAuth> },
      { path: '/backoffice/financeiro', element: <RequireAuth perm="backoffice.view"><FinanceSettingsPage /></RequireAuth> },
      { path: '/obras', element: <RequireAuth perm="operations.view"><OperationsList key="p" kind="projects" /></RequireAuth> },
      { path: '/obras/:id', element: <RequireAuth perm="operations.view"><OperationDetail key="p" kind="projects" /></RequireAuth> },
      { path: '/furos', element: <RequireAuth perm="operations.view"><OperationsList key="b" kind="boreholes" /></RequireAuth> },
      { path: '/furos/:id', element: <RequireAuth perm="operations.view"><OperationDetail key="b" kind="boreholes" /></RequireAuth> },
      { path: '/rh/trabalhadores', element: <RequireAuth perm="hr.view"><EmployeesList /></RequireAuth> },
      { path: '/rh/trabalhadores/:id', element: <RequireAuth perm="hr.view"><EmployeeDetail /></RequireAuth> },
      { path: '/rh/assiduidade', element: <RequireAuth perm="hr.view"><AttendancePage /></RequireAuth> },
      { path: '/rh/ferias', element: <RequireAuth perm="hr.view"><LeavesPage /></RequireAuth> },
      { path: '/rh/salarios', element: <RequireAuth perm="hr.view"><PayrollList /></RequireAuth> },
      { path: '/rh/salarios/:id', element: <RequireAuth perm="hr.view"><PayrollDetail /></RequireAuth> },
      { path: '/limpeza', element: <RequireAuth perm="operations.view"><CleaningPage /></RequireAuth> },
      { path: '/documentos', element: <RequireAuth perm="documents.view"><DocumentsPage /></RequireAuth> },
      { path: '/tarefas', element: <RequireAuth perm="tasks.view"><TasksPage /></RequireAuth> },
      { path: '/agenda', element: <RequireAuth perm="tasks.view"><AgendaPage /></RequireAuth> },
      { path: '/facturas', element: <RequireAuth perm="finance.view"><InvoicesPage /></RequireAuth> },
      { path: '/backoffice/documentos', element: <RequireAuth perm="backoffice.view"><DocumentSettingsPage /></RequireAuth> },
      { path: '/utilizadores', element: <RequireAuth perm="admin.view"><UsersPage /></RequireAuth> },
      { path: '/perfis', element: <RequireAuth perm="admin.view"><RolesPage /></RequireAuth> },
      { path: '/auditoria', element: <RequireAuth perm="admin.view"><AuditPage /></RequireAuth> },
      { path: '/backoffice/linhas-negocio', element: <RequireAuth perm="backoffice.view"><BusinessLinesPage /></RequireAuth> },
      { path: '/backoffice/configuracoes', element: <RequireAuth perm="backoffice.view"><SettingsPage /></RequireAuth> },
      { path: '*', element: <div className="text-slate-600">Página não encontrada.</div> },
    ],
  },
]);
