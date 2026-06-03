import { describe, it, expect } from "vitest";
import { provisionTenantInputSchema } from "./onboarding";

describe("provisionTenantInputSchema", () => {
  it("accepts a kebab-case slug + name (settings optional)", () => {
    const parsed = provisionTenantInputSchema.parse({ slug: "second-tenant", name: "Second Tenant" });
    expect(parsed.slug).toBe("second-tenant");
    expect(parsed.settings).toBeUndefined();
  });

  it("accepts an optional partial settings override", () => {
    const parsed = provisionTenantInputSchema.parse({
      slug: "t2",
      name: "T2",
      settings: { brandVoice: { tone: "bold", audience: "explorers" } },
    });
    expect(parsed.settings?.brandVoice?.tone).toBe("bold");
  });

  it("rejects a non-kebab-case slug (uppercase / spaces)", () => {
    expect(provisionTenantInputSchema.safeParse({ slug: "Bad Slug", name: "x" }).success).toBe(false);
    expect(provisionTenantInputSchema.safeParse({ slug: "UPPER", name: "x" }).success).toBe(false);
    expect(provisionTenantInputSchema.safeParse({ slug: "-leading", name: "x" }).success).toBe(false);
  });

  it("requires a non-empty name", () => {
    expect(provisionTenantInputSchema.safeParse({ slug: "ok", name: "" }).success).toBe(false);
  });
});
