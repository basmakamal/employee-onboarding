/**
 * Strategy interface for outbound channels. Swapping email providers (or
 * adding SMS/WhatsApp later) never touches callers — they depend on this
 * interface only.
 */
export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Notifier {
  send(message: OutboundMessage): Promise<void>;
}
