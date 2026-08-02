import { Router } from 'express';
import { config } from './common/config.js';
import { logger } from './common/logger.js';
import { createApp } from './app.js';
import { buildContainer } from './container.js';
import { startSlaScheduler } from './workflow/sla-scheduler.js';
import { requireAuth, requireRole } from './auth/require-auth.middleware.js';
import { authRouter } from './auth/auth.routes.js';
import { traineeRouter } from './modules/trainees/trainee.routes.js';
import { employeeRouter } from './modules/employees/employee.routes.js';
import { assetRouter } from './modules/assets/asset.routes.js';
import { linkRouter } from './modules/trainees/link.routes.js';

const container = buildContainer();

const staffApi = Router();
staffApi.use(requireAuth(container.authService));
staffApi.use(requireRole('HR', 'ADMIN'));
staffApi.use('/trainees', traineeRouter(container.traineeService));
staffApi.use('/employees', employeeRouter(container.employeeService));
staffApi.use('/', assetRouter(container.assetService));

const app = createApp({
  checkReady: async () => {
    await container.prisma.$queryRaw`SELECT 1`;
  },
  authRouter: authRouter(container.authService),
  staffRouter: staffApi,
  linkRouter: linkRouter(container.traineeService, container.assetService, container.linkTokenService),
});

const server = app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

// The BRD automation engine: reminders, daily nags, auto-expiry.
const stopScheduler =
  config.SLA_TICK_MINUTES > 0
    ? startSlaScheduler(container.slaScheduler, config.SLA_TICK_MINUTES)
    : () => {};
if (config.SLA_TICK_MINUTES > 0) {
  logger.info(`SLA scheduler running every ${config.SLA_TICK_MINUTES} minute(s)`);
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
    void container.prisma.$disconnect().finally(() => process.exit(0));
  });
  // Hard exit if draining takes too long.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
