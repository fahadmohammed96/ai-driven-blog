import { describe, it, expect } from "vitest";
import {
  EXTERNAL_METRIC_SOURCES,
  METRIC_SOURCES,
  metricInputSchema,
  sourceKind,
} from "./analytics";

describe("analytics contracts", () => {
  it("classifies internal vs external sources (unknown → internal)", () => {
    expect(sourceKind("affiliate")).toBe("internal");
    expect(sourceKind("email")).toBe("internal");
    expect(sourceKind("ga4")).toBe("external");
    expect(sourceKind("search_console")).toBe("external");
    // Unknown sources default to internal (never falsely labelled "stub").
    expect(sourceKind("whatever")).toBe("internal");
  });

  it("lists exactly the external (stubbed) sources", () => {
    expect([...EXTERNAL_METRIC_SOURCES].sort()).toEqual(["ga4", "search_console"]);
    // The two third-party sources are external; the four internal ones are not.
    expect(METRIC_SOURCES.affiliate).toBe("internal");
    expect(METRIC_SOURCES.ga4).toBe("external");
  });

  it("defaults metric-input channel/period/contentItemId and rejects non-finite values", () => {
    const parsed = metricInputSchema.parse({ source: "affiliate", metric: "clicks", value: 5 });
    expect(parsed.channel).toBeNull();
    expect(parsed.period).toBe("all");
    expect(parsed.contentItemId).toBeNull();

    expect(metricInputSchema.safeParse({ source: "ga4", metric: "sessions", value: Infinity }).success).toBe(
      false,
    );
  });
});
