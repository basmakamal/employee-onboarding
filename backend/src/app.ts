import express, { type Router } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { logger } from './common/logger.js';
import { errorHandler } from './common/http.js';
import { config } from './common/config.js';

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
  app.use(helmet({ contentSecurityPolicy: false })); // JSON API — CSP is the SPA's concern
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  const limiterDefaults = {
    standardHeaders: true,
    legacyHeaders: false,
    // Vitest/supertest fire many requests from one "IP" — relax under test.
    skip: () => config.NODE_ENV === 'test',
  };
  /** Brute-force guard on credentials. */
  app.use(
    '/api/auth/login',
    rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 20 }),
  );
  /** Token guessing on public signed links. */
  app.use('/api/link', rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 120 }));

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
