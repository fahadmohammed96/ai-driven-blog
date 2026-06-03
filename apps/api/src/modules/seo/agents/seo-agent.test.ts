import { describe, it, expect } from "vitest";
import { seoProposalSchema } from "@blogs/contracts";
import {
  SeoAgent,
  slugify,
  uniqueSlug,
  READABILITY_ESCALATION_THRESHOLD,
  type SeoAccessors,
} from "./seo-agent";
import { scoreReadability } from "./tools/score-readability";
import { StubLlmAdapter, type LlmPort, type LlmRequest } from "../../../platform/ai/llm";

// SEO Agent on the generic AgentRunner (Slice S1). Stub LLM everywhere → zero
// cost. Most of the payload is deterministic; the LLM only authors the copy.

const TENANT = "11111111-1111-1111-1111-111111111111";
const ITEM = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

const DRAFT =
  "Ho camminato lungo la costa della Sicilia al tramonto. Il viaggio mi ha sorpreso a ogni tappa, " +
  "tra sapori, incontri e silenzi che porto ancora con me.";

function fakeAccessors(over: Partial<SeoAccessors> = {}): SeoAccessors {
  return {
    internalLinkCandidates: async () => [
      { contentItemId: OTHER, title: "Le spiagge della Sardegna" },
      // The current item must never link to itself.
      { contentItemId: ITEM, title: "L'articolo corrente" },
    ],
    existingContent: async () => [],
    ...over,
  };
}

/** A fake port that records every request and returns a fixed completion. */
function capturingLlm(content: string): { port: LlmPort; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const port: LlmPort = {
    complete: async (req) => {
      calls.push(req);
      return {
        content,
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      };
    },
  };
  return { port, calls };
}

describe("slug helpers (deterministic)", () => {
  it("slugify lowercases, strips accents/punctuation, hyphenates", () => {
    expect(slugify("Città del Capo: il mare!")).toBe("citta-del-capo-il-mare");
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("slugify never returns empty (falls back)", () => {
    expect(slugify("!!! ???")).toBe("contenuto");
  });

  it("uniqueSlug suffixes against an existing index", () => {
    const existing = new Set(["sicilia", "sicilia-2"]);
    expect(uniqueSlug("sicilia", existing)).toBe("sicilia-3");
    expect(uniqueSlug("sardegna", existing)).toBe("sardegna");
  });
});

describe("SeoAgent.run", () => {
  it("requires exactly one of { llm, provider }", () => {
    expect(() => new SeoAgent({ accessors: fakeAccessors() } as never)).toThrow();
  });

  it("produces a valid SeoProposal with non-null fields from a prose stub", async () => {
    const agent = new SeoAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() });
    const proposal = await agent.run({ contentItemId: ITEM, draft: DRAFT }, { tenantId: TENANT });

    expect(proposal.type).toBe("seo_suggestions");
    expect(proposal.agentId).toBe("seo");
    expect(proposal.requiresHumanGate).toBe(true);
    // Zod-valid payload (the agent's outputSchema).
    expect(seoProposalSchema.safeParse(proposal.payload).success).toBe(true);

    const seo = proposal.payload;
    expect(seo.contentItemId).toBe(ITEM);
    expect(seo.title.length).toBeGreaterThan(0);
    expect(seo.metaDescription.length).toBeGreaterThan(0);
    expect(seo.primaryKeyword.length).toBeGreaterThan(0);
    expect(seo.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    // Readability is computed deterministically from the draft.
    expect(seo.readabilityScore).toBe(scoreReadability(DRAFT));
  });

  it("uses the LLM's editorial copy when it returns JSON", async () => {
    const content = JSON.stringify({
      title: "Sicilia al tramonto",
      metaDescription: "Un viaggio lento lungo la costa siciliana.",
      primaryKeyword: "sicilia",
    });
    const agent = new SeoAgent({
      llm: new StubLlmAdapter({ content }),
      accessors: fakeAccessors(),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, draft: DRAFT },
      { tenantId: TENANT },
    );
    expect(payload.title).toBe("Sicilia al tramonto");
    expect(payload.metaDescription).toBe("Un viaggio lento lungo la costa siciliana.");
    expect(payload.primaryKeyword).toBe("sicilia");
    expect(payload.slug).toBe("sicilia-al-tramonto");
  });

  it("derives a UNIQUE slug against existing content (anti-collision)", async () => {
    const content = JSON.stringify({
      title: "Sicilia al tramonto",
      metaDescription: "desc",
      primaryKeyword: "sicilia",
    });
    const agent = new SeoAgent({
      llm: new StubLlmAdapter({ content }),
      accessors: fakeAccessors({
        existingContent: async () => [
          { contentItemId: OTHER, title: "Sicilia al tramonto", slug: "sicilia-al-tramonto" },
        ],
      }),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, draft: DRAFT },
      { tenantId: TENANT },
    );
    expect(payload.slug).toBe("sicilia-al-tramonto-2");
  });

  it("does NOT collide with the item's OWN existing slug (self-exclusion)", async () => {
    // existingContent returns ALL the tenant's items, including the one being
    // optimized. Its own slug must NOT count as a collision — otherwise every first
    // suggestion gets a spurious "-2" on the deterministic path. Mirrors the
    // internal-link self-filter.
    const agent = new SeoAgent({
      llm: new StubLlmAdapter(), // prose stub → deterministic fallback uses the explicit title
      accessors: fakeAccessors({
        existingContent: async () => [
          { contentItemId: ITEM, title: "Sicilia al tramonto", slug: "sicilia-al-tramonto" },
        ],
      }),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, draft: DRAFT, title: "Sicilia al tramonto" },
      { tenantId: TENANT },
    );
    expect(payload.slug).toBe("sicilia-al-tramonto");
  });

  it("includes internal links but never links the item to itself", async () => {
    const agent = new SeoAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() });
    const { payload } = await agent.run(
      { contentItemId: ITEM, draft: DRAFT },
      { tenantId: TENANT },
    );
    expect(payload.internalLinks.map((l) => l.contentItemId)).toEqual([OTHER]);
    expect(payload.internalLinks[0]!.anchor).toBe("Le spiagge della Sardegna");
  });

  it("escalates fast→balanced only when readability is below threshold", async () => {
    // A long, complex sentence scores below the threshold → balanced.
    const hard =
      "L'organizzazione infrastrutturale dell'amministrazione metropolitana richiede una pianificazione particolarmente sofisticata, multidimensionale e interdisciplinare.";
    expect(scoreReadability(hard)).toBeLessThan(READABILITY_ESCALATION_THRESHOLD);
    const hardLlm = capturingLlm("{}");
    await new SeoAgent({ llm: hardLlm.port, accessors: fakeAccessors() }).run(
      { contentItemId: ITEM, draft: hard },
      { tenantId: TENANT },
    );
    expect(hardLlm.calls[0]!.model).toBe("balanced");

    // Simple short sentences score above the threshold → fast.
    const easy = "Vado al mare. Il sole è bello. Mi piace molto.";
    expect(scoreReadability(easy)).toBeGreaterThanOrEqual(READABILITY_ESCALATION_THRESHOLD);
    const easyLlm = capturingLlm("{}");
    await new SeoAgent({ llm: easyLlm.port, accessors: fakeAccessors() }).run(
      { contentItemId: ITEM, draft: easy },
      { tenantId: TENANT },
    );
    expect(easyLlm.calls[0]!.model).toBe("fast");
  });

  it("runs a tool then finishes (one-tool-then-end scenario)", async () => {
    const agent = new SeoAgent({
      llm: new StubLlmAdapter({ scenario: "one-tool-then-end" }),
      accessors: fakeAccessors(),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, draft: DRAFT },
      { tenantId: TENANT },
    );
    // Even after a tool round-trip, the deterministic merge yields a valid payload.
    expect(seoProposalSchema.safeParse(payload).success).toBe(true);
  });
});
