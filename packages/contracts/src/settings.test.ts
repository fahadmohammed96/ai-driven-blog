import { describe, it, expect } from "vitest";
import {
  AUTONOMY_LEVELS,
  AUDIT_POLICIES,
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

  it("defaults aiProvider to the platform/stub connector (metadata only)", () => {
    expect(DEFAULT_TENANT_SETTINGS.aiProvider).toEqual({ connector: "stub" });
    // Legacy rows with no aiProvider still parse and inherit the default.
    const parsed = tenantSettingsSchema.parse({
      brandVoice: { tone: "", audience: "" },
      specialistAutonomy: DEFAULT_TENANT_SETTINGS.specialistAutonomy,
      channels: DEFAULT_TENANT_SETTINGS.channels,
    });
    expect(parsed.aiProvider).toEqual({ connector: "stub" });
    expect(withSettingsDefaults({}).aiProvider).toEqual({ connector: "stub" });
  });

  it("defaults auditPolicy to obbligatorio (strict audit gate)", () => {
    expect(AUDIT_POLICIES).toEqual(["obbligatorio", "best-effort"]);
    expect(DEFAULT_TENANT_SETTINGS.auditPolicy).toBe("obbligatorio");
    // Legacy rows with no auditPolicy still parse and inherit the strict default.
    const parsed = tenantSettingsSchema.parse({
      brandVoice: { tone: "", audience: "" },
      specialistAutonomy: DEFAULT_TENANT_SETTINGS.specialistAutonomy,
      channels: DEFAULT_TENANT_SETTINGS.channels,
    });
    expect(parsed.auditPolicy).toBe("obbligatorio");
    expect(withSettingsDefaults({}).auditPolicy).toBe("obbligatorio");
    expect(withSettingsDefaults({ auditPolicy: "best-effort" }).auditPolicy).toBe("best-effort");
  });

  it("defaults externalResearch to OFF (per-tenant opt-in, Slice X1)", () => {
    expect(DEFAULT_TENANT_SETTINGS.externalResearch).toEqual({ enabled: false });
    // Legacy rows with no externalResearch still parse and inherit the opt-OUT default.
    const parsed = tenantSettingsSchema.parse({
      brandVoice: { tone: "", audience: "" },
      specialistAutonomy: DEFAULT_TENANT_SETTINGS.specialistAutonomy,
      channels: DEFAULT_TENANT_SETTINGS.channels,
    });
    expect(parsed.externalResearch).toEqual({ enabled: false });
    expect(withSettingsDefaults({}).externalResearch).toEqual({ enabled: false });
    expect(withSettingsDefaults({ externalResearch: { enabled: true } }).externalResearch).toEqual({
      enabled: true,
    });
  });

  it("rejects an unknown auditPolicy", () => {
    const bad = { ...DEFAULT_TENANT_SETTINGS, auditPolicy: "lax" };
    expect(tenantSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown aiProvider connector", () => {
    const bad = { ...DEFAULT_TENANT_SETTINGS, aiProvider: { connector: "openai" } };
    expect(tenantSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid autonomy level", () => {
    const bad = {
      ...DEFAULT_TENANT_SETTINGS,
      specialistAutonomy: { ...DEFAULT_TENANT_SETTINGS.specialistAutonomy, writer: "full-self-driving" },
    };
    expect(tenantSettingsSchema.safeParse(bad).success).toBe(false);
  });
});
