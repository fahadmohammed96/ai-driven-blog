import { describe, it, expect } from "vitest";
import { blocksSchema, type Itinerary } from "@blogs/contracts";
import type { LlmClient, LlmInput } from "../../platform/ai/llm";
import { assembleArticleFromItinerary, type ArticlePhoto } from "./article";

const TOKYO_PHOTO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KYOTO_PHOTO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const itinerary: Itinerary = {
  title: "Giappone in primavera",
  stops: [
    { place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04", notes: "Shibuya e ramen" },
    { place: "Kyoto", startDate: "2026-04-05", endDate: "2026-04-07", notes: "templi" },
  ],
};

const photos: ArticlePhoto[] = [
  { assetId: TOKYO_PHOTO, stopIndex: 0, caption: "Shibuya all'ora blu" },
  { assetId: KYOTO_PHOTO, stopIndex: 1 },
];

// Returns a generic (experience-free) paragraph -> the authenticity meter should flag it.
class FakeLlm implements LlmClient {
  public calls: LlmInput[] = [];
  async complete(input: LlmInput): Promise<string> {
    this.calls.push(input);
    return "Una destinazione famosa e molto visitata, ricca di attrazioni e luoghi noti.";
  }
}

describe("assembleArticleFromItinerary", () => {
  it("produces a valid block article titled after the itinerary", async () => {
    const llm = new FakeLlm();
    const { blocks } = await assembleArticleFromItinerary(
      { llm },
      { itinerary, voice: { tone: "entusiasta", audience: "foodie" }, photos },
    );
    expect(blocksSchema.safeParse(blocks).success).toBe(true);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Giappone in primavera" });
  });

  it("embeds each photo inside its own stop's section", async () => {
    const llm = new FakeLlm();
    const { blocks } = await assembleArticleFromItinerary(
      { llm },
      { itinerary, voice: { tone: "calmo", audience: "viaggiatori" }, photos },
    );

    const tokyoH = blocks.findIndex((b) => b.type === "heading" && b.text === "Tokyo");
    const kyotoH = blocks.findIndex((b) => b.type === "heading" && b.text === "Kyoto");
    const tokyoImg = blocks.findIndex((b) => b.type === "image" && b.assetId === TOKYO_PHOTO);
    const kyotoImg = blocks.findIndex((b) => b.type === "image" && b.assetId === KYOTO_PHOTO);

    // Tokyo's photo sits within the Tokyo section (after Tokyo heading, before Kyoto heading).
    expect(tokyoH).toBeGreaterThanOrEqual(0);
    expect(tokyoImg).toBeGreaterThan(tokyoH);
    expect(tokyoImg).toBeLessThan(kyotoH);
    expect(kyotoImg).toBeGreaterThan(kyotoH);

    const tokyoImage = blocks[tokyoImg];
    expect(tokyoImage?.type === "image" && tokyoImage.caption).toBe("Shibuya all'ora blu");
    expect(tokyoImage?.type === "image" && tokyoImage.alt).toBe("Tokyo");
  });

  it("writes one paragraph per stop in the brand voice, using stop notes", async () => {
    const llm = new FakeLlm();
    const { system } = await assembleArticleFromItinerary(
      { llm },
      { itinerary, voice: { tone: "entusiasta", audience: "foodie" }, userNotes: "viaggio di nozze", photos },
    );
    expect(system).toContain("entusiasta");
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]?.system).toContain("entusiasta");
    expect(llm.calls[0]?.prompt).toContain("Tokyo");
    expect(llm.calls[0]?.prompt).toContain("Shibuya e ramen");
    expect(llm.calls[0]?.prompt).toContain("viaggio di nozze");
    expect(llm.calls[1]?.prompt).toContain("Kyoto");
  });

  it("flags generic sections via the authenticity meter", async () => {
    const llm = new FakeLlm();
    const { authenticity } = await assembleArticleFromItinerary(
      { llm },
      { itinerary, voice: { tone: "entusiasta", audience: "foodie" }, photos },
    );
    expect(authenticity.score).toBe(0); // both fake paragraphs are generic
    expect(authenticity.flags.length).toBe(2);
    expect(authenticity.flags[0]?.suggestion).toMatch(/esperienza/i);
  });

  it("passes RAG context into the prompt when a retriever is provided", async () => {
    const llm = new FakeLlm();
    await assembleArticleFromItinerary(
      { llm, retrieve: async () => ["Adoro i mercatini di Kyoto."] },
      { itinerary, voice: { tone: "calmo", audience: "viaggiatori" } },
    );
    expect(llm.calls[0]?.prompt).toContain("Adoro i mercatini di Kyoto.");
  });
});
