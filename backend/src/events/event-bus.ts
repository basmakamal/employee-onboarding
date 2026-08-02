import { logger } from '../common/logger.js';

/**
 * Minimal in-process event bus (Observer pattern).
 *
 * Services publish domain events; notification handlers subscribe. Handlers
 * run out of band — a slow or failing handler NEVER breaks the state
 * transition that emitted the event (errors are logged, not thrown).
 * The interface is queue-ready: publish() can later push to a real queue
 * without touching any publisher.
 */
export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
}

type Handler = (event: DomainEvent) => Promise<void> | void;

export class EventBus {
  private readonly handlers = new Map<string, Handler[]>();

  on(type: string, handler: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  publish(event: DomainEvent): void {
    const list = this.handlers.get(event.type) ?? [];
    for (const handler of list) {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err: unknown) => {
          logger.error({ err, eventType: event.type }, 'event handler failed');
        });
    }
  }
}
