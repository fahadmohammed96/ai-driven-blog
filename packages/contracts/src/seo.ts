import { z } from "zod";

/**
 * SeoProposal — the SEO Agent's structured payload (agentic-plan Slice S1). The
 * SEO specialist stops being a settings "knob" and becomes an agent that
 * PROPOSES title / meta description / primary keyword / slug / internal links /
 * readability for a content item. It is NON-BLOCKING: on approval the proposal is
 * annotated onto `content_items.seo_proposal` (a JSONB field), it does NOT add a
 * new publication state (decision in the plan's conflict-resolution table — the
 * SEO enriches, it does not gate).
 *
 * It rides the common `Proposal<T>` envelope with `type: 'seo_suggestions'`,
 * lands in `agent_proposals` staging (T1) and is consumed by the existing human
 * gate. Most fields are computed DETERMINISTICALLY (readability via
 * Flesch-Kincaid, slug, internal-link candidates via similarity) — the LLM only
 * authors the editorial copy (title / meta / keyword), the cost-control §5
 * "deterministic tools preferred to the LLM" principle made structural.
 */

/** A proposed internal link from this item to another of the tenant's items. */
export const internalLinkSchema = z.object({
  /** The target content item to link to (tenant-scoped, RLS). */
  contentItemId: z.string().uuid(),
  /** The human-readable anchor text for the link (the target's title). */
  anchor: z.string().min(1),
});
export type InternalLink = z.infer<typeof internalLinkSchema>;

/**
 * A URL slug: lowercase alphanumeric words separated by single hyphens, no
 * leading/trailing/double hyphen. The same shape {@link slugify} emits, so a
 * deterministically-derived slug always validates.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase words separated by single hyphens");

export const seoProposalSchema = z.object({
  /** The content item this proposal annotates (the SEO subject). */
  contentItemId: z.string().uuid(),
  /** SEO title tag (≤ ~60 chars is best practice; capped lenient at 120). */
  title: z.string().min(1).max(120),
  /** Meta description (≤ ~155 chars is best practice; capped lenient at 320). */
  metaDescription: z.string().min(1).max(320),
  /** The single keyword the page should rank for. */
  primaryKeyword: z.string().min(1),
  slug: slugSchema,
  /** Internal-link suggestions toward related tenant content (may be empty). */
  internalLinks: z.array(internalLinkSchema),
  /** Flesch Reading Ease (0..100): higher = easier to read. Deterministic. */
  readabilityScore: z.number().min(0).max(100),
});
export type SeoProposal = z.infer<typeof seoProposalSchema>;
