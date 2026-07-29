import { config } from './common/config.js';
import { logger } from './common/logger.js';
import { prisma } from './common/prisma.js';
import { createApp } from './app.js';

const app = createApp({
  checkReady: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});

const server = app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

// Graceful shutdown: stop accepting connections, drain in-flight requests.
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close((err) => {
    if (err) {
      logger.error(err, 'error during shutdown');
      process.exit(1);
    }
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  // Hard exit if draining takes too long.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
