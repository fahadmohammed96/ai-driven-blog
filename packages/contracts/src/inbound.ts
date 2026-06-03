import { z } from "zod";

/**
 * InboundProposal — the Inbound Agent's output (agentic-plan Slice O2). The
 * Inbound Agent is the CRM "front door": given a raw inbound signal (a comment,
 * an info request, a custom-trip enquiry) it CLASSIFIES it, drafts a courteous
 * reply, qualifies a potential lead, and suggests the next human action. Unlike
 * the Fase-3 lead pipeline (`createLead → draftLeadProposal → approveAndSend`),
 * this is a BROADER triage that emits an INFORMATIVE proposal: it is staged as a
 * `lead_classification` proposal that the founder ACKNOWLEDGES (NO send, NO lead
 * mutation downstream) — the recognition guides the founder, who then acts via
 * the existing lead pipeline or replies by hand.
 *
 * OUTPUT-SAFETY: every field stays plain TEXT (the proposal card escapes by
 * default; there is no `href`/URL field here), so a drafted reply or a rationale
 * line can never become an injection vector when rendered.
 */

/** The triage bucket the inbound signal falls into (heuristic, DEBT-039). */
export const inboundClassificationSchema = z.enum(["info", "lead", "reclamo"]);
export type InboundClassification = z.infer<typeof inboundClassificationSchema>;

/** Coarse buying intent inferred from the message (deterministic heuristic). */
export const inboundIntentSchema = z.enum(["hot", "warm", "cold"]);
export type InboundIntent = z.infer<typeof inboundIntentSchema>;

/**
 * A qualified lead derived from the signal. Present only when the signal looks
 * like an opportunity (classification `lead`, or a message tied to an existing
 * lead). `leadId` ties the qualification to an existing pipeline lead when the
 * caller supplied one; `summary` is a free-text précis of what the prospect wants.
 */
export const leadQualificationSchema = z.object({
  intent: inboundIntentSchema,
  summary: z.string(),
  /** The existing pipeline lead this signal relates to, if any. */
  leadId: z.string().optional(),
});
export type LeadQualification = z.infer<typeof leadQualificationSchema>;

/**
 * The Inbound Agent's report payload. `classification`/`leadQualification`/
 * `suggestedNextAction` are computed DETERMINISTICALLY (a keyword heuristic seed,
 * stable in CI); `proposedReply` is the seed reply optionally refined by the LLM.
 * The `lead_classification` proposal carries this as its payload.
 */
export const inboundProposalSchema = z.object({
  classification: inboundClassificationSchema,
  proposedReply: z.string(),
  leadQualification: leadQualificationSchema.optional(),
  suggestedNextAction: z.string(),
  rationale: z.string(),
});
export type InboundProposal = z.infer<typeof inboundProposalSchema>;
