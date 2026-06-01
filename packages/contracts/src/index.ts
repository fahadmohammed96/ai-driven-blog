import { z } from "zod";

export const tenantSchema = z.object({
  id: z.string().uuid(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1),
});

export type Tenant = z.infer<typeof tenantSchema>;

export * from "./blocks";
export * from "./itinerary";
export * from "./publication";
export * from "./channel";
export * from "./newsletter";
export * from "./settings";
export * from "./affiliate";
export * from "./commerce";
export * from "./crm";
export * from "./analytics";
export * from "./feedback";
export * from "./onboarding";
export * from "./proposal";
