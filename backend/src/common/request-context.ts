import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Where the work being done right now came from — carried implicitly
 * through every await, so an audit entry written deep inside a service still
 * knows which request (or scheduler run) caused it, without every function
 * passing it along.
 *
 *   WEB        a signed-in staff or employee request
 *   LINK       a signed-link page (data form, contract, custody, exit interview)
 *   SCHEDULER  the automation engine (reminders, expiries, dated changes)
 *   SYSTEM     anything else (boot jobs, scripts)
 */
export type RequestSource = 'WEB' | 'LINK' | 'SCHEDULER' | 'SYSTEM';

export interface RequestContext {
  requestId: string;
  source: RequestSource;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context of the work in progress, if any. */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Run `fn` (and everything it awaits) inside a context. */
export function withContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Express middleware: every request gets an id (pino's, when present) and its source. */
export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const requestId = String((req as { id?: unknown }).id ?? randomUUID());
    res.setHeader('X-Request-Id', requestId);
    storage.run({ requestId, source: req.originalUrl.startsWith('/api/link') ? 'LINK' : 'WEB' }, next);
  };
}
