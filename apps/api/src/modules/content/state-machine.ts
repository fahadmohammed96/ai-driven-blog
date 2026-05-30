import type { PublicationStatus } from "@blogs/contracts";

/** Events that drive the publication lifecycle. */
export type PublicationEvent = "propose" | "startReview" | "approve" | "requestChanges" | "publish";

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PublicationStatus,
    public readonly event: PublicationEvent,
  ) {
    super(`invalid transition: cannot '${event}' from '${from}'`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Allowed transitions. `publish` from `published` is a self-loop on purpose:
 * publishing is idempotent. Anything not listed is rejected.
 */
const TRANSITIONS: Record<PublicationStatus, Partial<Record<PublicationEvent, PublicationStatus>>> = {
  draft: { propose: "proposed" },
  proposed: { startReview: "review", requestChanges: "draft" },
  review: { approve: "approved", requestChanges: "draft" },
  approved: { publish: "published", requestChanges: "draft" },
  published: { publish: "published" },
};

/** Compute the next status for an event, or throw on an illegal transition. */
export function nextStatus(from: PublicationStatus, event: PublicationEvent): PublicationStatus {
  const to = TRANSITIONS[from][event];
  if (to === undefined) throw new InvalidTransitionError(from, event);
  return to;
}
