import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import type { OutboundMessage } from '../notifications/notifier.js';

/**
 * Queue plumbing — only meaningful when REDIS_URL is set. The API process
 * enqueues; `npm run worker` (src/worker.ts) processes. Without Redis the
 * app falls back to its original inline behavior everywhere.
 */
export const redisEnabled = Boolean(config.REDIS_URL);

export const MAIL_QUEUE = 'mail';
export const SLA_QUEUE = 'sla';

/** One outbound email: the persisted row id + the ready-to-send message. */
export interface MailJob {
  notificationId: string;
  message: OutboundMessage;
}

export function createRedis(): Redis {
  if (!config.REDIS_URL) throw new Error('REDIS_URL is not configured');
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

let sharedRedis: Redis | null = null;

/** Shared connection for non-BullMQ uses (refresh-token store, caches). */
export function getSharedRedis(): Redis {
  sharedRedis ??= createRedis();
  return sharedRedis;
}

let mailQueue: Queue<MailJob> | null = null;

/** Lazy singleton — constructing a Queue opens a Redis connection. */
export function getMailQueue(): Queue<MailJob> {
  mailQueue ??= new Queue<MailJob>(MAIL_QUEUE, {
    connection: createRedis(),
    defaultJobOptions: {
      // Transient SMTP failures retry with exponential backoff before the
      // notification row is marked FAILED for good.
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 }, // 30s, 1m, 2m, 4m, 8m
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return mailQueue;
}

export async function closeQueues(): Promise<void> {
  await mailQueue?.close();
  mailQueue = null;
  sharedRedis?.disconnect();
  sharedRedis = null;
}
