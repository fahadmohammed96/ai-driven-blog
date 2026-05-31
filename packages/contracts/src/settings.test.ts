import { describe, it, expect } from "vitest";
import {
  AUTONOMY_LEVELS,
  SPECIALISTS,
  DEFAULT_TENANT_SETTINGS,
  tenantSettingsSchema,
  withSettingsDefaults,
} from "./settings";

describe("tenant settings contracts", () => {
  it("defaults every specialist to manual autonomy", () => {
    for (const s of SPECIALISTS) {
      expect(DEFAULT_TENANT_SETTINGS.specialistAutonomy[s]).toBe("manual");
    }
  });

  it("offers manual / semi-auto / auto-within-limits as the autonomy knob", () => {
    expect(AUTONOMY_LEVELS).toEqual(["manual", "semi-auto", "auto-within-limits"]);
  });

  it("defaults channels to the known channels, all disabled", () => {
    expect(DEFAULT_TENANT_SETTINGS.channels.map((c) => c.channel)).toEqual([
      "instagram",
      "x",
      "pinterest",
    ]);
    expect(DEFAULT_TENANT_SETTINGS.channels.every((c) => c.enabled === false)).toBe(true);
  });

  it("fills a partial value with defaults into a complete, valid settings object", () => {
    const merged = withSettingsDefaults({ brandVoice: { tone: "personale" } });
    expect(merged.brandVoice).toEqual({ tone: "personale", audience: "" });
    expect(merged.specialistAutonomy.writer).toBe("manual");
    expect(tenantSettingsSchema.safeParse(merged).success).toBe(true);
  });

  it("rejects an invalid autonomy level", () => {
    const bad = {
      ...DEFAULT_TENANT_SETTINGS,
      specialistAutonomy: { ...DEFAULT_TENANT_SETTINGS.specialistAutonomy, writer: "full-self-driving" },
    };
    expect(tenantSettingsSchema.safeParse(bad).success).toBe(false);
  });
});
