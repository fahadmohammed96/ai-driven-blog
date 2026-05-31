import type { LeadStatus } from "@blogs/contracts";

/**
 * Events that drive the custom-trip CRM pipeline. The human-in-the-loop gate is
 * `approve`: an `ai_drafted` proposal becomes `human_approved` only when a human
 * approves it, and only an approved lead can be `markSent` to the client (the
 * routing port is invoked exactly there — nothing reaches the client before
 * approval). `reject` sends a draft back to `received` for a re-draft (revise).
 */
export type LeadEvent =
  | "draftProposal"
  | "approve"
  | "reject"
  | "markSent"
  | "requestDeposit"
  | "confirmPayment"
  | "deliver"
  | "cancel";

export class InvalidLeadTransitionError extends Error {
  constructor(
    public readonly from: LeadStatus,
    public readonly event: LeadEvent,
  ) {
    super(`invalid lead transition: cannot '${event}' from '${from}'`);
    this.name = "InvalidLeadTransitionError";
  }
}

/**
 * Allowed transitions. The happy path is `received → ai_drafted → human_approved →
 * sent → deposit_pending → confirmed → delivered`. `reject` loops a draft back to
 * `received`; `cancel` ends any non-terminal lead. `delivered` and `cancelled` are
 * terminal. Anything not listed is rejected.
 */
const TRANSITIONS: Record<LeadStatus, Partial<Record<LeadEvent, LeadStatus>>> = {
  received: { draftProposal: "ai_drafted", cancel: "cancelled" },
  ai_drafted: { approve: "human_approved", reject: "received", cancel: "cancelled" },
  human_approved: { markSent: "sent", cancel: "cancelled" },
  sent: { requestDeposit: "deposit_pending", cancel: "cancelled" },
  deposit_pending: { confirmPayment: "confirmed", cancel: "cancelled" },
  confirmed: { deliver: "delivered", cancel: "cancelled" },
  delivered: {},
  cancelled: {},
};

/** Compute the next status for an event, or throw on an illegal transition. */
export function nextLeadStatus(from: LeadStatus, event: LeadEvent): LeadStatus {
  const to = TRANSITIONS[from][event];
  if (to === undefined) throw new InvalidLeadTransitionError(from, event);
  return to;
}
