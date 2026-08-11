/**
 * Background worker — run alongside the API when REDIS_URL is set:
 *
 *   npm run worker        (dev: tsx watch)
 *   node dist/worker.js   (production, e.g. a PM2 app)
 *
 * Owns everything that must not run on the web server's request path:
 *   - mail queue: delivers persisted notifications with retries/backoff
 *   - SLA engine: one repeatable tick job (single worker → no double-firing,
 *     no matter how many API instances are running)
 */
import { Queue, Worker } from 'bullmq';
import { config } from './common/config.js';
import { logger } from './common/logger.js';
import { buildContainer } from './container.js';
import { createRedis, MAIL_QUEUE, SLA_QUEUE, closeQueues, type MailJob } from './common/queue.js';

if (!config.REDIS_URL) {
  logger.error('REDIS_URL is not set — the worker has nothing to do (email sends inline and the SLA timer runs in the API process). Exiting.');
  process.exit(1);
}

const container = buildContainer();

// ------------------------------------------------------------------- mail
const mailWorker = new Worker<MailJob>(
  MAIL_QUEUE,
  async (job) => {
    await container.notifier.send(job.data.message);
    await container.repos.notificationRepo.markSent(job.data.notificationId, new Date());
  },
  { connection: createRedis(), concurrency: 5 },
);

mailWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id, attempt: job?.attemptsMade }, 'mail job failed');
  // Only the FINAL attempt marks the row FAILED — earlier ones will retry.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void container.repos.notificationRepo
      .markFailed(job.data.notificationId)
      .catch((e: unknown) => logger.error({ err: e }, 'could not mark notification failed'));
  }
});

// -------------------------------------------------------------------- SLA
const slaQueue = new Queue(SLA_QUEUE, { connection: createRedis() });
const slaWorker = new Worker(
  SLA_QUEUE,
  async () => {
    await container.slaScheduler.tick();
  },
  // concurrency 1 — ticks never overlap, even if one runs long.
  { connection: createRedis(), concurrency: 1 },
);

slaWorker.on('failed', (_job, err) => logger.error({ err }, 'SLA tick failed'));

async function main() {
  if (config.SLA_TICK_MINUTES > 0) {
    await slaQueue.upsertJobScheduler(
      'sla-tick',
      { every: config.SLA_TICK_MINUTES * 60_000 },
      { name: 'tick' },
    );
    logger.info(`SLA tick scheduled every ${config.SLA_TICK_MINUTES} minute(s)`);
  }
  logger.info('worker up: mail queue + SLA engine');
}

async function shutdown(signal: string) {
  logger.info(`${signal} received, worker shutting down`);
  await Promise.allSettled([mailWorker.close(), slaWorker.close(), slaQueue.close()]);
  await closeQueues();
  await container.prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err: unknown) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
