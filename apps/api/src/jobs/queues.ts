import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../lib/env';

// CLAUDE.md §8
export type QueueName = 'vendus' | 'meta-inbound' | 'outbound' | 'automations' | 'alerts' | 'reports' | 'backup';

let connection: Redis | undefined;
export const redis = () => (connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }));

const queues = new Map<QueueName, Queue>();

export function queue(name: QueueName) {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    queues.set(name, q);
  }
  return q;
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  await connection?.quit();
}
