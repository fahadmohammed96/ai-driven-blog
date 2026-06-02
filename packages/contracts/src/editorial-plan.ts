import { z } from "zod";

/**
 * EditorialPlan — the Editorial Orchestrator's payload (agentic-plan Slice O3).
 *
 * The Orchestrator is the ONE agent that calls the other agents as tools
 * (flat, centralized orchestration). It does NOT write content and does NOT
 * publish: it PLANS — a calendar of slots, editorial priorities, and per-agent
 * notes gathered from the sub-agents it consulted — and stages the plan as a
 * `Proposal<EditorialPlan>` (type `editorial_plan`) in `agent_proposals` for the
 * human gate. Propose-only is preserved (ADR-0020): the plan is ALWAYS staged
 * `pending`, never auto-executed (the autonomy engine that would execute it is
 * DEBT-041, deferred — founder "seam only" decision).
 */

/**
 * A planned editorial slot. `when` is a human-readable period label (e.g.
 * "Settimana 1"), `topic` the subject to cover, `channel` the optional target
 * distribution channel, `rationale` why it earns the slot.
 */
export const editorialSlotSchema = z.object({
  when: z.string().min(1),
  topic: z.string().min(1),
  channel: z.string().optional(),
  rationale: z.string(),
});
export type EditorialSlot = z.infer<typeof editorialSlotSchema>;

/** A prioritized item the founder should act on, with the reason it ranks. */
export const editorialPrioritySchema = z.object({
  item: z.string().min(1),
  why: z.string(),
});
export type EditorialPriority = z.infer<typeof editorialPrioritySchema>;

export const editorialPlanSchema = z.object({
  /** The planning horizon this plan covers, in days. */
  horizonDays: z.number().int().positive(),
  /** At least one slot — the deterministic seed always yields a non-empty plan. */
  slots: z.array(editorialSlotSchema).min(1),
  priorities: z.array(editorialPrioritySchema),
  /**
   * Notes the Orchestrator gathered from the sub-agents it consulted, keyed by
   * the sub-agent's id STRING (`writer`/`seo`/`analyst`/…) — NOT the `SPECIALISTS`
   * const (the map is open, so a failed/over-budget sub-agent simply records why
   * it could not contribute). A sub-agent failure lands here, never propagates.
   */
  agentNotes: z.record(z.string(), z.string()),
});
export type EditorialPlan = z.infer<typeof editorialPlanSchema>;
