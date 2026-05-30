import { z } from "zod";

/**
 * Newsletter (Fase 2): GDPR double opt-in. A subscriber starts `pending` (asked
 * to subscribe), becomes `confirmed` only after clicking the tokenized link, and
 * can `unsubscribe`. Lists are segmented by **theme** (cross-cutting taxonomy).
 */
export const subscriberStatusSchema = z.enum(["pending", "confirmed", "unsubscribed"]);
export type SubscriberStatus = z.infer<typeof subscriberStatusSchema>;

/** A theme tag (lowercase slug), e.g. "party" | "natura" | "cultura". */
export const themeSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "theme must be a lowercase slug");
export type Theme = z.infer<typeof themeSchema>;

export const subscribeRequestSchema = z.object({
  email: z.string().email(),
  themes: z.array(themeSchema).min(1),
});
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const sendNewsletterRequestSchema = z.object({
  theme: themeSchema,
  subject: z.string().min(1),
  html: z.string().min(1),
});
export type SendNewsletterRequest = z.infer<typeof sendNewsletterRequestSchema>;
