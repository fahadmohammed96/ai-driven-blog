import { describe, it, expect } from "vitest";
import { metricInputSchema } from "@blogs/contracts";
import { Ga4SourceStub, SearchConsoleSourceStub, createExternalSources } from "./external-sources";

// The external sources are stubbed at the boundary: no live API/keys/network.
// These assert they are deterministic, well-formed, and marked `external` (so the
// dashboard can label them as stubbed). A stub takes no context (no DB/API).

describe("external analytics sources (stubbed at the boundary)", () => {
  it("GA4 stub returns deterministic per-channel sessions/users marked external", async () => {
    const src = new Ga4SourceStub();
    expect(src.kind).toBe("external");
    const a = await src.collect();
    const b = await src.collect();
    expect(a).toEqual(b); // deterministic
    expect(a.every((m) => m.source === "ga4")).toBe(true);
    expect(a.some((m) => m.channel === "organic" && m.metric === "sessions")).toBe(true);
    // Every row validates against the unified metric-input contract.
    expect(a.every((m) => metricInputSchema.safeParse(m).success)).toBe(true);
  });

  it("Search Console stub returns organic impressions/clicks + a non-count avg position", async () => {
    const src = new SearchConsoleSourceStub();
    expect(src.kind).toBe("external");
    const rows = await src.collect();
    expect(rows.every((m) => m.source === "search_console" && m.channel === "organic")).toBe(true);
    const pos = rows.find((m) => m.metric === "avg_position");
    expect(pos?.value).toBeCloseTo(14.2); // doubles, not just integer counts
  });

  it("registers exactly the two external stub sources", () => {
    const sources = createExternalSources();
    expect(sources.map((s) => s.source).sort()).toEqual(["ga4", "search_console"]);
    expect(sources.every((s) => s.kind === "external")).toBe(true);
  });
});
