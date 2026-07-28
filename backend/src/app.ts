import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './common/logger.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  // Liveness: the process is up.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Readiness: dependencies reachable. DB check lands with Phase 1 (Prisma).
  app.get('/api/ready', (_req, res) => {
    res.json({ status: 'ready', checks: { db: 'not-configured-yet' } });
  });

  return app;
}
