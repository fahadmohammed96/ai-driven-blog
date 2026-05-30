import { z } from "zod";

/**
 * Publication lifecycle (PRODUCT: human-in-the-loop state machine). The AI
 * proposes, the human reviews/approves, then it is published.
 * bozza → proposta → revisione → approvato → pubblicato.
 */
export const publicationStatusSchema = z.enum([
  "draft",
  "proposed",
  "review",
  "approved",
  "published",
]);
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

export const PUBLICATION_STATUSES = publicationStatusSchema.options;
