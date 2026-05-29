import { describe, it, expect } from "vitest";
import { tenantSchema } from "./index";

const validId = "00000000-0000-0000-0000-000000000000";

describe("tenantSchema", () => {
  it("accepts a valid tenant", () => {
    const result = tenantSchema.safeParse({
      id: validId,
      slug: "acme-travel",
      name: "Acme Travel",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty slug", () => {
    const result = tenantSchema.safeParse({
      id: validId,
      slug: "",
      name: "Acme Travel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a slug with invalid characters", () => {
    const result = tenantSchema.safeParse({
      id: validId,
      slug: "Acme Travel",
      name: "Acme Travel",
    });
    expect(result.success).toBe(false);
  });
});
