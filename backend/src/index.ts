import { Router } from 'express';
import { config } from './common/config.js';
import { logger } from './common/logger.js';
import { createApp } from './app.js';
import { buildContainer } from './container.js';
import { startSlaScheduler } from './workflow/sla-scheduler.js';
import { requireAuth } from './auth/require-auth.middleware.js';
import { authRouter } from './auth/auth.routes.js';
import { employeeRouter } from './modules/employees/employee.routes.js';
import { assetRouter } from './modules/assets/asset.routes.js';
import { offboardingRouter } from './modules/offboarding/offboarding.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { usersRouter } from './auth/users.routes.js';
import { employeeDocumentRouter } from './modules/employees/employee-document.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { notificationRouter } from './notifications/notification.routes.js';
import { linkRouter } from './modules/employees/link.routes.js';
import { aiRouter } from './ai/ai.routes.js';
import { asyncHandler } from './common/http.js';
import { requireRole } from './auth/require-auth.middleware.js';
import { statfsSync } from 'node:fs';
import { closeQueues, getMailQueue, getSharedRedis, redisEnabled } from './common/queue.js';
import { uploadRoot } from './common/storage.js';
import { subscribeNotify } from './notifications/realtime.js';
import type { Response } from 'express';

const container = buildContainer();

// Any active staff member may enter; ownership per status is enforced by
// the state machines (roles on transitions) and per-route gates below.
const staffApi = Router();
staffApi.use(requireAuth(container.authService));
const docRouters = employeeDocumentRouter({
  documents: container.repos.employeeDocuments,
  firings: container.repos.slaFirings,
  audit: container.repos.audit,
});
staffApi.use('/employees/:id/documents', docRouters.nested);
staffApi.use('/employee-documents', docRouters.flat);
staffApi.use('/employees', employeeRouter(container.employeeService, container.onboardingService));
staffApi.use('/offboardings', offboardingRouter(container.offboardingService));
staffApi.use('/reports', reportsRouter(container.reportsService));
staffApi.use(
  '/settings',
  settingsRouter(
    container.settingsService,
    container.repos.slaRules,
    container.ownershipService,
    container.repos.holidays,
  ),
);
staffApi.use('/users', usersRouter(container.repos.users));
staffApi.use('/notifications', notificationRouter(container.repos.notificationRepo));
staffApi.use('/ai', aiRouter(container.aiService));
staffApi.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    res.json(await container.dashboardService.summary());
  }),
);
/** Queue visibility for admins (feeds the phase-6 health dashboard). */
staffApi.get(
  '/admin/queues',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    if (!redisEnabled) {
      res.json({ enabled: false });
      return;
    }
    const mail = await getMailQueue().getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    res.json({ enabled: true, mail });
  }),
);
/** One health snapshot for admins: DB, Redis, queues, disk, table growth. */
staffApi.get(
  '/admin/health',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const t0 = Date.now();
    const db = await container.prisma
      .$queryRaw`SELECT 1`.then(() => ({ up: true, latencyMs: Date.now() - t0 }))
      .catch(() => ({ up: false, latencyMs: null as number | null }));

    let redis: { up: boolean } | { up: false } = { up: false };
    let mail = null;
    if (redisEnabled) {
      redis = await getSharedRedis()
        .ping()
        .then(() => ({ up: true }))
        .catch(() => ({ up: false }));
      mail = await getMailQueue()
        .getJobCounts('waiting', 'active', 'failed', 'delayed')
        .catch(() => null);
    }

    // Growth of the unbounded tables — what retention keeps in check.
    const [auditLogs, notifications, slaFirings, linkTokens] = await Promise.all([
      container.prisma.auditLog.count(),
      container.prisma.notification.count(),
      container.prisma.slaFiring.count(),
      container.prisma.linkToken.count(),
    ]);

    let disk: { totalGb: number; freeGb: number; usedPct: number } | null = null;
    try {
      const s = statfsSync(uploadRoot);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      disk = {
        totalGb: Math.round(total / 1e9),
        freeGb: Math.round(free / 1e9),
        usedPct: Math.round(((total - free) / total) * 100),
      };
    } catch {
      /* statfs unavailable on this platform — omit */
    }

    res.json({
      db,
      redis: redisEnabled ? redis : { up: false, configured: false },
      queues: { mail },
      tables: { auditLogs, notifications, slaFirings, linkTokens },
      storage: disk,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }),
);
// ---------------------------------------------------------------- realtime
// Server-sent events: one long-lived response per open tab. The client
// reconnects on drop and keeps a slow poll as its fallback, so losing this
// stream never loses notifications — only their immediacy.
const sseClients = new Map<string, Set<Response>>();
const unsubscribeNotify = subscribeNotify((userId) => {
  for (const res of sseClients.get(userId) ?? []) {
    res.write('event: notify\ndata: 1\n\n');
  }
});

staffApi.get('/events', (req, res) => {
  const userId = req.actor?.id;
  if (!userId) {
    res.status(401).end();
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  const mine = sseClients.get(userId) ?? new Set<Response>();
  mine.add(res);
  sseClients.set(userId, mine);

  // Comment-line heartbeat keeps proxies from reaping the idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  heartbeat.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    mine.delete(res);
    if (mine.size === 0) sseClients.delete(userId);
  });
});

staffApi.use('/', assetRouter(container.assetService));

const app = createApp({
  checkReady: async () => {
    await container.prisma.$queryRaw`SELECT 1`;
  },
  authRouter: authRouter(container.authService),
  staffRouter: staffApi,
  linkRouter: linkRouter(
    container.onboardingService,
    container.assetService,
    container.offboardingService,
    container.linkTokenService,
  ),
});

const server = app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

// The BRD automation engine: reminders, daily nags, auto-expiry.
// With Redis it runs in the worker process (npm run worker) — exactly one
// instance, no matter how many API processes exist. Without Redis it keeps
// the original in-process timer.
const runInline = config.SLA_TICK_MINUTES > 0 && !redisEnabled;
const stopScheduler = runInline
  ? startSlaScheduler(container.slaScheduler, config.SLA_TICK_MINUTES)
  : () => {};
if (runInline) {
  logger.info(`SLA scheduler running in-process every ${config.SLA_TICK_MINUTES} minute(s)`);
} else if (redisEnabled) {
  logger.info('Redis mode: SLA engine + mail delivery run in the worker (npm run worker)');
}

// Graceful shutdown: stop accepting connections, drain in-flight requests.
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopScheduler();
  unsubscribeNotify();
  for (const clients of sseClients.values()) for (const res of clients) res.end();
  server.close((err) => {
    if (err) {
      logger.error(err, 'error during shutdown');
      process.exit(1);
    }
    void closeQueues()
      .catch(() => undefined)
      .then(() => container.prisma.$disconnect())
      .finally(() => process.exit(0));
  });
  // Hard exit if draining takes too long.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
