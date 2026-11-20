import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { env } from './lib/env';
import { AppError } from './lib/errors';
import { prisma } from './lib/prisma';
import { auditRoutes } from './modules/audit/routes';
import { authRoutes } from './modules/auth/routes';
import { backofficeRoutes } from './modules/backoffice/routes';
import { roleRoutes } from './modules/roles/routes';
import { clientRoutes } from './modules/clients/routes';
import { contractRoutes } from './modules/contracts/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { opportunityRoutes } from './modules/opportunities/routes';
import { orderRoutes } from './modules/orders/routes';
import { proposalRoutes } from './modules/proposals/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { floorRoutes } from './modules/floor/routes';
import { productionConfigRoutes } from './modules/production/config.routes';
import { productionRoutes } from './modules/production/routes';
import { stockRoutes } from './modules/stock/routes';
import { communicationRoutes } from './modules/communication/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { financeRoutes } from './modules/finance/routes';
import { operationRoutes } from './modules/operations/routes';
import { hrRoutes } from './modules/hr/routes';
import { reportRoutes } from './modules/reports/routes';
import { documentRoutes, fileRoutes } from './modules/documents/routes';
import { invoiceRoutes } from './modules/invoices/routes';
import { taskRoutes } from './modules/tasks/routes';
import { userRoutes } from './modules/users/routes';
import { webhookRoutes } from './modules/webhooks/routes';
import { registerAuth } from './plugins/auth';
import { registerErrorHandler } from './plugins/errors';

/** `onRoute` (testes): recebe cada rota registada e se tem preHandler (guarda de acesso). */
export async function buildApp(opts: { onRoute?: (r: { route: string; guarded: boolean }) => void } = {}) {
  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024, // logótipo em base64 nas settings
    trustProxy: true, // atrás do Nginx
    logger:
      env.NODE_ENV === 'test'
        ? false
        : env.NODE_ENV === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : true,
  });

  if (opts.onRoute) {
    app.addHook('onRoute', (r) => {
      for (const m of [r.method].flat()) opts.onRoute!({ route: `${m} ${r.url}`, guarded: !!r.preHandler });
    });
  }
  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET });
  // ponytail: contadores em memória (1 processo API). Passar para Redis se a API correr em cluster.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Demasiadas tentativas. Aguarde um minuto.'),
  });
  registerAuth(app);

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(roleRoutes, { prefix: '/api/roles' });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(backofficeRoutes, { prefix: '/api/backoffice' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(clientRoutes, { prefix: '/api/clients' });
  await app.register(opportunityRoutes, { prefix: '/api/opportunities' });
  await app.register(proposalRoutes, { prefix: '/api/proposals' });
  await app.register(orderRoutes, { prefix: '/api/orders' });
  await app.register(contractRoutes, { prefix: '/api/contracts' });
  await app.register(stockRoutes, { prefix: '/api/stock' });
  await app.register(catalogRoutes, { prefix: '/api/catalog' });
  await app.register(productionConfigRoutes, { prefix: '/api/production/config' });
  await app.register(productionRoutes, { prefix: '/api/production' });
  await app.register(floorRoutes, { prefix: '/api/floor' });
  await app.register(documentRoutes, { prefix: '/api/documents' });
  await app.register(fileRoutes, { prefix: '/api/files' });
  await app.register(taskRoutes, { prefix: '/api/tasks' });
  await app.register(invoiceRoutes, { prefix: '/api/invoices' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(communicationRoutes, { prefix: '/api/communication' });
  await app.register(financeRoutes, { prefix: '/api/finance' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.register(operationRoutes, { prefix: '/api/operations' });
  await app.register(hrRoutes, { prefix: '/api/hr' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });

  return app;
}
