import { EventEmitter } from 'node:events';
import { createRedis, getSharedRedis, redisEnabled } from '../common/queue.js';

/**
 * "You have a new in-app notification" signal, from wherever the row was
 * created to the API process holding the user's event stream.
 *
 * With Redis it rides pub/sub — necessary because SLA reminders are created
 * in the WORKER process, not the API. Without Redis everything happens in
 * one process, so a local emitter is enough.
 */
const CHANNEL = 'notify:in-app';

const local = new EventEmitter();
local.setMaxListeners(0);

export function publishNotify(userId: string): void {
  if (redisEnabled) {
    void getSharedRedis()
      .publish(CHANNEL, userId)
      .catch(() => undefined); // realtime is best-effort; the bell still polls
  } else {
    local.emit('notify', userId);
  }
}

/** Subscribe once per API process; returns an unsubscribe function. */
export function subscribeNotify(handler: (userId: string) => void): () => void {
  if (redisEnabled) {
    // Pub/sub needs a dedicated connection (a subscribed conn can't query).
    const sub = createRedis();
    void sub.subscribe(CHANNEL);
    sub.on('message', (_channel, userId) => handler(userId));
    return () => sub.disconnect();
  }
  local.on('notify', handler);
  return () => local.off('notify', handler);
}
