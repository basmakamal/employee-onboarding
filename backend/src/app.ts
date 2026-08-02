import express, { type Router } from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { logger } from './common/logger.js';
import { errorHandler } from './common/http.js';

export interface AppDeps {
  /** Resolves when dependencies (DB) are reachable; rejects otherwise. */
  checkReady?: () => Promise<void>;
  /** Login/refresh/logout/me. */
  authRouter?: Router;
  /** Staff API surface (mounted at /api), already wrapped with auth middleware. */
  staffRouter?: Router;
  /** Public signed-link surface — token IS the auth. */
  linkRouter?: Router;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(cookieParser());
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

  if (deps.authRouter) app.use('/api/auth', deps.authRouter);
  if (deps.linkRouter) app.use('/api/link', deps.linkRouter);
  if (deps.staffRouter) app.use('/api', deps.staffRouter);

  app.use(errorHandler);
  return app;
}
