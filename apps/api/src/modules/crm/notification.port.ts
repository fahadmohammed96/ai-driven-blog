import type { NotificationChannel } from "@blogs/contracts";

/** What is being routed to the client — the proposal/offer, or the final itinerary. */
export type NotificationKind = "proposal" | "itinerary";

/** An outbound client notification routed through a {@link NotificationPort}. */
export interface ClientNotification {
  /** The lead this notification is for (used as the idempotency anchor). */
  leadId: string;
  channel: NotificationChannel;
  /** The recipient — an email address or a phone number, per channel. */
  to: string;
  kind: NotificationKind;
  body: string;
}

/** The outcome of routing a notification. `ref` is the provider message id. */
export interface NotificationResult {
  ref: string;
  status: "sent" | "failed";
}

/**
 * Outbound client-notification seam (Fase 3, ADR-0024). The CRM domain depends on
 * this port, not on WhatsApp Business / SMTP. In production a real router (WhatsApp
 * Business API + the existing EmailPort for the mail leg) lives behind config; in
 * dev/CI a deterministic stub implements it — no live WhatsApp, no real SMTP, no
 * network. Mirrors the `EmailPort` (Fase 2) / `PaymentPort` (Fase 3) pattern.
 *
 * This is the OUTBOUND half of the human-in-the-loop gate: the service only ever
 * calls `notify` for a lead that a human has approved.
 */
export interface NotificationPort {
  notify(msg: ClientNotification): Promise<NotificationResult>;
}
