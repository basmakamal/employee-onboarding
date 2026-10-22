/**
 * Strategy interface for outbound channels. Swapping email providers (or
 * adding SMS/WhatsApp later) never touches callers — they depend on this
 * interface only.
 */
export interface OutboundMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always present — it is the deliverability baseline and
   *  what the in-app notification log stores. */
  text: string;
  /** Optional branded HTML alternative. Clients that support it show this;
   *  everything else falls back to `text`. */
  html?: string;
}

export interface Notifier {
  send(message: OutboundMessage): Promise<void>;
}
