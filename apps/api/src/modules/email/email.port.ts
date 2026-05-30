/** A renderable email message (channel-agnostic; an EmailPort delivers it). */
export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Outbound email seam (ADR-0006: email is "native" via a provider API in prod;
 * SMTP→Mailhog in dev/test). The domain depends on this port, not a transport.
 */
export interface EmailPort {
  send(msg: EmailMessage): Promise<void>;
}
