import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './common/logger.js';

export interface AppDeps {
  /** Resolves when dependencies (DB) are reachable; rejects otherwise. */
  checkReady?: () => Promise<void>;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  // Liveness: the process is up.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Readiness: dependencies reachable.
  app.get('/api/ready', (req, res) => {
    if (!deps.checkReady) {
      res.json({ status: 'ready', checks: { db: 'not-configured' } });
      return;
    }
    deps
      .checkReady()
      .then(() => res.json({ status: 'ready', checks: { db: 'up' } }))
      .catch((err: unknown) => {
        req.log.error(err, 'readiness check failed');
        res.status(503).json({ status: 'not-ready', checks: { db: 'down' } });
      });
  });

  return app;
}
