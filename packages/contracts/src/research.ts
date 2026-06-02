import { z } from "zod";

/**
 * ResearchBrief — the Researcher agent's EPHEMERAL output (agentic-plan Slice X1).
 *
 * Unlike the specialists (SEO/Social/Email), the Researcher does NOT stage a
 * `Proposal` of its own: there is no `research_brief` queue, no dedicated table,
 * no `/researcher/suggest` endpoint. The brief is gathered in-memory, scoped to a
 * single Writer generation job, and used two ways (critica #9/#14):
 *  1. injected into the Writer's `buildPrompt` (the `researchContext` block), so
 *     the draft is anchored to the gathered facts/sources;
 *  2. laid onto `Proposal.researchContext` of the Writer proposal it enriched, so
 *     the human gate can show "Fonti usate dal Ricercatore" (propose-only
 *     transparency). Audit of the run itself lands in the Researcher's own
 *     `ai_agent_runs` row (the existing audit table), never a new one.
 *
 * Cost-zero invariant: with the per-tenant external flag OFF the brief is built
 * from INTERNAL sources only (the tenant's own RAG/itinerary), and the
 * `searchSources` boundary tool is never reachable.
 */

/**
 * A web source the Researcher surfaced. `url` is validated AND scheme-guarded to
 * http(s) (output-safety): `z.string().url()` alone accepts `javascript:`/`data:`
 * URLs (the URL constructor does), and the url flows into an `<a href>` on the
 * proposals card — the same XSS sink the S3 email fix closed with `safeHref`.
 */
export const researchSourceSchema = z.object({
  title: z.string(),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), { message: "only http(s) URLs" }),
});
export type ResearchSource = z.infer<typeof researchSourceSchema>;

export const researchBriefSchema = z.object({
  /** Concrete facts gathered (from internal RAG/itinerary and, if on, the web). */
  facts: z.array(z.string()),
  /** External sources, with validated URLs. Empty when external research is off. */
  sources: z.array(researchSourceSchema),
  /** A few synthesised takeaways the Writer should foreground. */
  keyInsights: z.array(z.string()),
  /** Open questions / missing evidence the human should be aware of. */
  gapsToFill: z.array(z.string()),
  /** The agent's own narrative reasoning for this brief. */
  rationale: z.string(),
});
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
