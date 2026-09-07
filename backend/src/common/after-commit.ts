import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './logger.js';

type Callback = () => void | Promise<void>;

/**
 * Side effects that must only happen once a transaction has committed.
 *
 * A state transition runs inside `prisma.$transaction`; an email triggered
 * by it must not go out if that transaction later rolls back. Code deep in
 * the engine calls `afterCommit(cb)`; when it is running under
 * `withAfterCommit` the callback is queued and run after the work resolves,
 * otherwise (no transaction — e.g. the SLA scheduler) it runs straight away.
 */
const pending = new AsyncLocalStorage<Callback[]>();

export async function withAfterCommit<T>(work: () => Promise<T>): Promise<T> {
  const callbacks: Callback[] = [];
  const result = await pending.run(callbacks, work);
  for (const cb of callbacks) {
    try {
      await cb();
    } catch (err) {
      logger.error({ err }, 'after-commit callback failed');
    }
  }
  return result;
}

export function afterCommit(cb: Callback): void {
  const callbacks = pending.getStore();
  if (callbacks) {
    callbacks.push(cb);
    return;
  }
  void Promise.resolve()
    .then(cb)
    .catch((err: unknown) => logger.error({ err }, 'post-transition callback failed'));
}
