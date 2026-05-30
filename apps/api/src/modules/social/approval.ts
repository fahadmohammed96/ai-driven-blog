/** Channel-post approval: the human-in-the-loop gate before a post can go out (Fase 2.5). */
export const POST_STATUSES = ["draft", "approved", "rejected"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export type PostAction = "approve" | "reject";

export class InvalidPostTransitionError extends Error {
  constructor(from: string, action: PostAction) {
    super(`cannot ${action} a channel post in status '${from}'`);
    this.name = "InvalidPostTransitionError";
  }
}

/**
 * Pure transition for the approval gate. Approve/reject settle a 'draft' post;
 * re-applying the same outcome is idempotent (safe side-effects), while the
 * opposite transition on an already-settled post is refused.
 */
export function nextPostStatus(current: string, action: PostAction): PostStatus {
  if (action === "approve") {
    if (current === "draft" || current === "approved") return "approved";
    throw new InvalidPostTransitionError(current, action);
  }
  if (current === "draft" || current === "rejected") return "rejected";
  throw new InvalidPostTransitionError(current, action);
}
