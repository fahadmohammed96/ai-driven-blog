import { describe, it, expect } from "vitest";
import type { Block } from "@blogs/contracts";
import { measureAuthenticity, EXPERIENCE_SUGGESTION } from "./authenticity";

const lived =
  "Ho passeggiato per Shibuya al tramonto e ho mangiato il ramen più buono della mia vita.";
const generic =
  "Tokyo è la capitale del Giappone, una metropoli enorme, moderna e molto popolosa.";

describe("measureAuthenticity", () => {
  it("does not flag a paragraph written in first person, scoring it fully", () => {
    const blocks: Block[] = [
      { type: "heading", level: 2, text: "Tokyo" },
      { type: "paragraph", text: lived },
    ];
    const report = measureAuthenticity(blocks);
    expect(report.flags).toEqual([]);
    expect(report.score).toBe(1);
  });

  it("flags a generic, experience-free paragraph and scores it zero", () => {
    const blocks: Block[] = [
      { type: "heading", level: 2, text: "Tokyo" },
      { type: "paragraph", text: generic },
    ];
    const report = measureAuthenticity(blocks);
    expect(report.flags).toHaveLength(1);
    expect(report.flags[0]).toMatchObject({ blockIndex: 1, heading: "Tokyo", suggestion: EXPERIENCE_SUGGESTION });
    expect(report.score).toBe(0);
  });

  it("flags only the generic section in a mixed draft and attributes its heading", () => {
    const blocks: Block[] = [
      { type: "heading", level: 2, text: "Tokyo" },
      { type: "paragraph", text: lived },
      { type: "heading", level: 2, text: "Kyoto" },
      { type: "paragraph", text: generic },
    ];
    const report = measureAuthenticity(blocks);
    expect(report.flags).toHaveLength(1);
    expect(report.flags[0]?.blockIndex).toBe(3);
    expect(report.flags[0]?.heading).toBe("Kyoto");
    expect(report.score).toBe(0.5);
  });

  it("ignores short paragraphs (captions) when judging", () => {
    const blocks: Block[] = [
      { type: "heading", level: 2, text: "Tokyo" },
      { type: "paragraph", text: "Foto al volo." },
    ];
    const report = measureAuthenticity(blocks);
    expect(report.flags).toEqual([]);
    expect(report.score).toBe(1);
  });
});
