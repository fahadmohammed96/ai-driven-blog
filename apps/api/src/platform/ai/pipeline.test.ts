import { describe, it, expect } from "vitest";
import { HashingEmbedder, cosineSimilarity } from "./embedder";
import { generateDraft, type BrandVoice } from "./pipeline";
import type { LlmClient, LlmInput } from "./llm";

class FakeLlm implements LlmClient {
  public lastCall: LlmInput | undefined;
  async complete(input: LlmInput): Promise<string> {
    this.lastCall = input;
    return `BOZZA: ${input.prompt.slice(0, 30)}`;
  }
}

describe("HashingEmbedder", () => {
  it("is deterministic", async () => {
    const e = new HashingEmbedder();
    expect(await e.embed("ramen in tokyo")).toEqual(await e.embed("ramen in tokyo"));
  });

  it("ranks overlapping text as more similar than unrelated text", async () => {
    const e = new HashingEmbedder();
    const q = await e.embed("japan food guide");
    const near = await e.embed("the best japan food and ramen");
    const far = await e.embed("ancient rome history colosseum");
    expect(cosineSimilarity(q, near)).toBeGreaterThan(cosineSimilarity(q, far));
  });
});

describe("generateDraft", () => {
  it("applies the brand voice and includes retrieved context + brief in the prompt", async () => {
    const embedder = new HashingEmbedder();
    const llm = new FakeLlm();
    const retrieved = ["Tokyo ramen guide: best bowls in Shinjuku."];
    const voice: BrandVoice = { tone: "entusiasta", audience: "foodie viaggiatori" };

    const result = await generateDraft(
      { embedder, llm, retrieve: async () => retrieved },
      { tenantId: "t1", brief: "Scrivi sul cibo in Giappone", voice },
    );

    expect(result.draft.length).toBeGreaterThan(0);
    expect(result.usedContext).toEqual(retrieved);
    expect(result.system).toContain("entusiasta");
    expect(llm.lastCall?.system).toContain("entusiasta");
    expect(llm.lastCall?.prompt).toContain("Tokyo ramen guide");
    expect(llm.lastCall?.prompt).toContain("cibo in Giappone");
  });
});
