import { Worker, type Processor } from 'bullmq';
import { processMetaInbound } from './integrations/meta';
import { processAlerts, scheduleAlerts } from './jobs/alerts';
import { processBackup, scheduleBackup } from './jobs/backup';
import { processOutbound } from './jobs/outbound';
import { processAutomation } from './modules/communication/automations';
import { processVendus } from './modules/invoices/service';
import { processReport } from './modules/reports/routes';
import { redis, type QueueName } from './jobs/queues';

const processors: Partial<Record<QueueName, Processor>> = {
  outbound: processOutbound,
  'meta-inbound': processMetaInbound,
  alerts: processAlerts,
  vendus: processVendus,
  automations: processAutomation,
  reports: processReport,
  backup: processBackup,
};

const workers = Object.entries(processors).map(([name, fn]) => {
  const w = new Worker(name, fn, { connection: redis() });
  w.on('failed', (job, err) => console.error(`[${name}] job ${job?.id} falhou (tentativa ${job?.attemptsMade}):`, err.message));
  return w;
});
await scheduleAlerts();
await scheduleBackup();
console.log(`Worker activo: ${Object.keys(processors).join(', ')}`);

process.on('SIGTERM', async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
