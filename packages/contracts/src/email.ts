import { z } from "zod";
import { themeSchema } from "./newsletter";

/**
 * EmailDraft — the Email Agent's structured payload (agentic-plan Slice S3). The
 * email specialist projects a published article into a newsletter draft for a
 * theme's segment, PROPOSE-ONLY: it rides the common `Proposal<T>` envelope with
 * `type: 'email_draft'`, lands in `agent_proposals` staging and is consumed by
 * the EXISTING Phase-2.5 distribution gate. On approval — and ONLY then — the
 * draft is sent to the theme's confirmed-opt-in segment (the INVARIANT: nothing
 * goes out without a human).
 *
 * The body is the DETERMINISTIC projection of the article (blocks → HTML); the
 * LLM layer (cost-control §5 biforcation) only refines the high-impact
 * `subject`/`preheader`. `contentItemId` + `theme` identify the subject article
 * and the target segment — they ride in the payload (like `SeoProposal` carries
 * `contentItemId`) so the gate can route the send without a side channel.
 */
export const emailDraftSchema = z.object({
  /** The source article the newsletter is projected from (the email subject). */
  contentItemId: z.string().uuid(),
  /** The segment to send to on approval: confirmed opt-in subscribers of this theme. */
  theme: themeSchema,
  /** The email subject line (LLM-refinable; deterministic default = article title). */
  subject: z.string().min(1).max(200),
  /** Inbox preview text shown after the subject (LLM-refinable; deterministic default). */
  preheader: z.string().min(1).max(200),
  /** The rendered HTML body — the DETERMINISTIC article projection (never the LLM's). */
  body: z.string().min(1),
  /** Call-to-action label (deterministic). */
  ctaText: z.string().min(1).max(120),
  /** Call-to-action target — the article's canonical URL (deterministic). */
  ctaUrl: z.string().min(1),
});
export type EmailDraft = z.infer<typeof emailDraftSchema>;
