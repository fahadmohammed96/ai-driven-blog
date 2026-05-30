import { describe, it, expect } from "vitest";
import { blocksSchema, type Itinerary } from "@blogs/contracts";
import { itineraryToBlocks } from "./itinerary";

const itinerary: Itinerary = {
  title: "Giappone in 10 giorni",
  stops: [
    {
      place: "Tokyo",
      geo: { lat: 35.68, lng: 139.69 },
      startDate: "2026-04-01",
      endDate: "2026-04-04",
      notes: "Shibuya e il miglior ramen.",
    },
    {
      place: "Kyoto",
      geo: { lat: 35.01, lng: 135.77 },
      startDate: "2026-04-05",
      endDate: "2026-04-07",
      notes: "Templi e giardini.",
    },
  ],
};

describe("itineraryToBlocks", () => {
  it("serializes into valid canonical blocks", () => {
    const blocks = itineraryToBlocks(itinerary);
    expect(blocksSchema.safeParse(blocks).success).toBe(true);
  });

  it("opens with the itinerary title as a level-1 heading", () => {
    const [first] = itineraryToBlocks(itinerary);
    expect(first).toEqual({ type: "heading", level: 1, text: "Giappone in 10 giorni" });
  });

  it("emits a level-2 heading + paragraph per stop, in order", () => {
    const blocks = itineraryToBlocks(itinerary);
    const headings = blocks.filter((b) => b.type === "heading" && b.level === 2);
    expect(headings.map((h) => (h.type === "heading" ? h.text : ""))).toEqual([
      "Tokyo",
      "Kyoto",
    ]);
    // 1 title + 2 stops * (heading + paragraph)
    expect(blocks).toHaveLength(5);
  });

  it("carries each stop's dates and notes into its paragraph", () => {
    const blocks = itineraryToBlocks(itinerary);
    const paragraphs = blocks.filter((b) => b.type === "paragraph");
    const tokyo = paragraphs[0];
    expect(tokyo?.type === "paragraph" && tokyo.text).toContain("2026-04-01");
    expect(tokyo?.type === "paragraph" && tokyo.text).toContain("2026-04-04");
    expect(tokyo?.type === "paragraph" && tokyo.text).toContain("ramen");
  });

  it("reflects an edit to a stop on reserialization", () => {
    const edited: Itinerary = {
      ...itinerary,
      stops: [{ ...itinerary.stops[0]!, place: "Osaka" }, itinerary.stops[1]!],
    };
    const headings = itineraryToBlocks(edited).filter(
      (b) => b.type === "heading" && b.level === 2,
    );
    expect(headings[0]?.type === "heading" && headings[0].text).toBe("Osaka");
  });
});
