import { Router } from 'express';
import { config } from './common/config.js';
import { logger } from './common/logger.js';
import { createApp } from './app.js';
import { buildContainer } from './container.js';
import { startSlaScheduler } from './workflow/sla-scheduler.js';
import { requireAuth } from './auth/require-auth.middleware.js';
import { actorScope, COMPANY_SCOPED_PREFIXES, requireCompany, requirePermission, staffOnly } from './auth/authz/authorize.js';
import { companyRouter } from './modules/companies/company.routes.js';
import { orgRouter } from './modules/organisation/org.routes.js';
import { assignmentsRouter, rolesRouter } from './auth/authz.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { employeeRouter } from './modules/employees/employee.routes.js';
import { assetRouter } from './modules/assets/asset.routes.js';
import { offboardingRouter } from './modules/offboarding/offboarding.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { usersRouter } from './auth/users.routes.js';
import { employeeDocumentRouter } from './modules/employees/employee-document.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { notificationRouter } from './notifications/notification.routes.js';
import { emailTemplatesRouter, emailTriggersRouter } from './notifications/email-admin.routes.js';
import { linkRouter } from './modules/employees/link.routes.js';
import { aiRouter } from './ai/ai.routes.js';
import { employeeAccountRouter } from './modules/employees/employee-account.routes.js';
import { meRouter } from './modules/self-service/me.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { registersRouter } from './modules/registers/registers.routes.js';
import { employeeScopeGuard } from './modules/employees/employee-scope.guard.js';
import { employmentHistoryRouter } from './modules/employees/employment-history.routes.js';
import { listsRouter } from './modules/lists/lists.routes.js';
import { asyncHandler } from './common/http.js';
import { statfsSync } from 'node:fs';
import { closeQueues, getMailQueue, getSharedRedis, redisEnabled } from './common/queue.js';
import { uploadRoot } from './common/storage.js';
import { subscribeNotify } from './notifications/realtime.js';
import type { Response } from 'express';

const container = buildContainer();

// The dropdown lists: whatever is missing is inserted at boot, so a fresh
// install and a live database offer the same choices without a manual step.
void container.listService
  .ensureDefaults()
  .catch((err: unknown) => logger.error({ err }, 'list values could not be seeded'));

// Employment history starts with an opening entry per employee (written once).
void container.employmentHistory
  .ensureOpenings()
  .catch((err: unknown) => logger.error({ err }, 'employment history could not be opened'));

// Every company runs its own automation: one without rules gets the defaults.
void container.prisma.company
  .findMany({ select: { id: true } })
  .then((rows) => container.companyDefaults.ensureAll(rows.map((r) => r.id)))
  .catch((err: unknown) => logger.error({ err }, 'default automation rules could not be created'));

// Any active staff member may enter; ownership per status is enforced by
// the state machines (roles on transitions) and per-route gates below.
const staffApi = Router();
staffApi.use(requireAuth(container.authService));
// Employee self-service logins may only reach /me and their notification bell.
staffApi.use(staffOnly());
// Global administration — the one HR-adjacent surface that works before a
// company is selected (it is how a super admin gets one).
staffApi.use('/companies', companyRouter(container.companyService));
staffApi.use('/roles', rolesRouter(container.assignmentService));
staffApi.use('/users/:id/assignments', assignmentsRouter(container.assignmentService));
// Company-owned data refuses to answer without a selected workspace; it
// never widens to "all companies".
staffApi.use([...COMPANY_SCOPED_PREFIXES], requireCompany());
const docRouters = employeeDocumentRouter({
  documents: container.repos.employeeDocuments,
  firings: container.repos.slaFirings,
  audit: container.repos.audit,
  employees: container.repos.employees,
});
staffApi.use('/employees/:id/documents', docRouters.nested);
staffApi.use('/employee-documents', docRouters.flat);
// Every /employees/:id/... route: the employee must be in the selected company and the actor's scope.
staffApi.use('/employees/:id', employeeScopeGuard(container.repos.employees));
// Employment history first: `/employees/changes` must not be read as an employee id.
staffApi.use('/employees', employmentHistoryRouter(container.employmentHistory));
staffApi.use(
  '/employees',
  employeeAccountRouter(container.employeeAccounts, (id) =>
    container.prisma.employee.findUnique({
      where: { id },
      select: {
        status: true, hireDate: true, orgUnitId: true, positionId: true, managerId: true, nationalId: true, iban: true,
        contract: { select: { status: true } },
        account: { select: { active: true } },
      },
    }),
  ),
);
// The audit trail of the selected company (read-only).
staffApi.use('/audit', auditRouter(container.prisma));
// Contracts / documents / offboardings across the company (scoped, paged).
staffApi.use('/registers', registersRouter(container.prisma));
// An employee's own data, for their self-service sign-in.
staffApi.use('/me', meRouter(container.prisma));
staffApi.use('/employees', employeeRouter(container.employeeService, container.onboardingService));
staffApi.use('/offboardings', offboardingRouter(container.offboardingService));
staffApi.use('/org', orgRouter(container.orgService));
staffApi.use('/reports', reportsRouter(container.reportsService));
staffApi.use(
  '/settings',
  settingsRouter(
    container.settingsService,
    container.repos.slaRules,
    container.ownershipService,
    container.repos.holidays,
    container.responsibilityService,
    container.repos.notificationGroups,
  ),
);
staffApi.use('/users', usersRouter(container.repos.users, container.notifications, config.APP_URL));
staffApi.use('/lists', listsRouter(container.listService));

staffApi.use(
  '/notifications',
  notificationRouter(container.repos.notificationRepo, container.notifications),
);
staffApi.use('/ai', aiRouter(container.aiService));
// Email templates, triggers (ADMIN) — the log lives under /notifications/log.
staffApi.use(
  '/email-templates',
  emailTemplatesRouter(container.templateService, container.notifications, container.repos.users),
);
staffApi.use('/email-triggers', emailTriggersRouter(container.triggerService));
staffApi.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    res.json(await container.dashboardService.summary(actorScope(req.actor)));
  }),
);
/** Queue visibility for admins (feeds the phase-6 health dashboard). */
staffApi.get(
  '/admin/queues',
  requirePermission('settings.manage'),
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
  requirePermission('settings.manage'),
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
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [auditLogs, notifications, slaFirings, linkTokens, lastRun, failedEmails, pendingEmails, failedChanges] = await Promise.all([
      container.prisma.auditLog.count(),
      container.prisma.notification.count(),
      container.prisma.slaFiring.count(),
      container.prisma.linkToken.count(),
      // The automation engine marks what it writes (see request-context).
      container.prisma.auditLog.findFirst({ where: { source: 'SCHEDULER' }, orderBy: { at: 'desc' }, select: { at: true } }),
      container.prisma.notification.count({ where: { channel: 'EMAIL', status: 'FAILED', createdAt: { gte: weekAgo } } }),
      container.prisma.notification.count({ where: { channel: 'EMAIL', status: 'PENDING', createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
      container.prisma.employmentEvent.count({ where: { status: 'FAILED' } }),
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
      jobs: {
        /** When the automation last wrote anything (a reminder, an expiry, a dated change). */
        lastAutomationActivity: lastRun?.at ?? null,
        failedEmailsLast7Days: failedEmails,
        /** Waiting more than 15 minutes — the mail queue or worker may be down. */
        stuckEmails: pendingEmails,
        failedScheduledChanges: failedChanges,
        mode: redisEnabled ? 'worker' : 'inline',
      },
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
  ...(config.API_DOCS ? { docs: { title: 'HR System', version: process.env['npm_package_version'] ?? '1.0.0' } } : {}),
  linkRouter: linkRouter(
    container.onboardingService,
    container.assetService,
    container.offboardingService,
    container.linkTokenService,
    container.listService,
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
