import type {
  ClientNotification,
  NotificationPort,
  NotificationResult,
} from "./notification.port";

/**
 * Deterministic in-memory NotificationPort for dev/CI. Every routed message is
 * recorded in {@link sent} (so tests can assert the human gate — nothing is routed
 * before approval) and the provider ref is a pure function of the lead + kind
 * (`<channel>_stub_<kind>_<leadId>`) so a retry is idempotent and exactly
 * assertable. No network, no WhatsApp, no SMTP — the boundary stub, exactly like
 * the Mailhog/Stripe stubs of earlier phases.
 */
export class StubNotificationClient implements NotificationPort {
  /** Every notification routed through this stub, in order — for assertions. */
  readonly sent: ClientNotification[] = [];

  async notify(msg: ClientNotification): Promise<NotificationResult> {
    this.sent.push(msg);
    const prefix = msg.channel === "whatsapp" ? "wa" : "mail";
    return { ref: `${prefix}_stub_${msg.kind}_${msg.leadId}`, status: "sent" };
  }
}

/**
 * Build the NotificationPort from env. Always returns the deterministic stub for
 * now.
 * TODO(debt): DEBT-012 — a real router (WhatsApp Business API + the EmailPort mail
 * leg) behind config is not implemented; wiring live messaging is a founder
 * follow-up (ADR-0024).
 */
export function createNotificationFromEnv(): NotificationPort {
  return new StubNotificationClient();
}
