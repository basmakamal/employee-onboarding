import { logger } from '../common/logger.js';
import type { Notifier, OutboundMessage } from './notifier.js';

/** Dev notifier — logs instead of sending. NOTIFIER=console (default). */
export class ConsoleNotifier implements Notifier {
  async send(message: OutboundMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject },
      `[email:console] ${message.text.slice(0, 120)}`,
    );
  }
}
