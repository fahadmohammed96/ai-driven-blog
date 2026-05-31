import { z } from "zod";

/**
 * Affiliate hub (Fase 3 — monetizzazione). A tenant creates trackable outbound
 * links; the `/go/:code` redirector resolves a link by its short `code`, records
 * a click (link · article · channel · timestamp) and 302-redirects to the
 * target. Counts are then aggregated per link / article / channel.
 */

/** URL-safe short code/slug used in `/go/:code` (unique per tenant). */
export const affiliateCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "code must be lowercase alphanumeric with dashes");

/**
 * Where a link is placed. Free-form on purpose: a distribution channel
 * (instagram/x/pinterest) but also "blog", "newsletter", … — the affiliate hub
 * tracks placements beyond the Fase-2 distribution channels.
 */
export const affiliatePlacementSchema = z.string().min(1).max(64);

/** Create an affiliate link. `code` is the immutable public key for `/go/`. */
export const createAffiliateLinkSchema = z.object({
  code: affiliateCodeSchema,
  targetUrl: z.string().url(),
  contentItemId: z.string().uuid().optional(),
  channel: affiliatePlacementSchema.optional(),
  label: z.string().min(1).max(200).optional(),
});
export type CreateAffiliateLink = z.infer<typeof createAffiliateLinkSchema>;

/**
 * Edit a link's editable fields (all optional). `code` is NOT editable — it is
 * the stable public `/go/` key. `null` clears the optional association.
 */
export const updateAffiliateLinkSchema = z.object({
  targetUrl: z.string().url().optional(),
  contentItemId: z.string().uuid().nullable().optional(),
  channel: affiliatePlacementSchema.nullable().optional(),
  label: z.string().min(1).max(200).nullable().optional(),
});
export type UpdateAffiliateLink = z.infer<typeof updateAffiliateLinkSchema>;

/** A link as returned by the read endpoints, with its total click count. */
export interface AffiliateLinkView {
  id: string;
  code: string;
  targetUrl: string;
  contentItemId: string | null;
  channel: string | null;
  label: string | null;
  createdAt: string;
  clicks: number;
}

/** Click counts aggregated three ways (per link · per article · per channel). */
export interface AffiliateStats {
  byLink: { linkId: string; code: string; clicks: number }[];
  byArticle: { contentItemId: string; clicks: number }[];
  byChannel: { channel: string; clicks: number }[];
}
