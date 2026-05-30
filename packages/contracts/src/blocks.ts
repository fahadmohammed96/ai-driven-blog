import { z } from "zod";

/**
 * Canonical content model (ADR-0004): a ContentItem body is an ordered list of
 * **blocks** in portable JSON — never HTML. The AI reasons over this structure;
 * renderers project it to blog/IG/newsletter. Position is the array index.
 */

export const headingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string(),
});
export type HeadingBlock = z.infer<typeof headingBlockSchema>;

export const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
});
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;

/** An image references a Media-DAM asset by id (the renderer resolves the URL). */
export const imageBlockSchema = z.object({
  type: z.literal("image"),
  assetId: z.string().uuid(),
  alt: z.string(),
  caption: z.string().optional(),
});
export type ImageBlock = z.infer<typeof imageBlockSchema>;

export const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  imageBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;

export const blocksSchema = z.array(blockSchema);
export type Blocks = z.infer<typeof blocksSchema>;
