import type { SubscriberStatus } from "@blogs/contracts";

/** Events that drive the double opt-in lifecycle. */
export type OptinEvent = "confirm" | "unsubscribe" | "resubscribe";

export class InvalidOptinTransitionError extends Error {
  constructor(
    public readonly from: SubscriberStatus,
    public readonly event: OptinEvent,
  ) {
    super(`invalid optin transition: cannot '${event}' from '${from}'`);
    this.name = "InvalidOptinTransitionError";
  }
}

/**
 * Allowed transitions. `confirm` from `confirmed` is a self-loop on purpose:
 * confirming a tokenized link twice is idempotent (no double counting).
 * Anything not listed is rejected.
 */
const TRANSITIONS: Record<SubscriberStatus, Partial<Record<OptinEvent, SubscriberStatus>>> = {
  pending: { confirm: "confirmed", unsubscribe: "unsubscribed" },
  confirmed: { confirm: "confirmed", unsubscribe: "unsubscribed" },
  unsubscribed: { resubscribe: "pending" },
};

/** Compute the next status for an event, or throw on an illegal transition. */
export function nextSubscriberStatus(from: SubscriberStatus, event: OptinEvent): SubscriberStatus {
  const to = TRANSITIONS[from][event];
  if (to === undefined) throw new InvalidOptinTransitionError(from, event);
  return to;
}
