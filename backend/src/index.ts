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
import { closeQueues, getMailQueue, redisEnabled } from './common/queue.js';

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
