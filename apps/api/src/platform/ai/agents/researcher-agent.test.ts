import { describe, it, expect } from "vitest";
import { researchBriefSchema } from "@blogs/contracts";
import { ResearcherAgent, type ResearcherAccessors } from "./researcher-agent";
import {
  createSearchSourcesTool,
  SEARCH_SOURCES_TOOL_ID,
  SEARCH_SOURCES_MAX_OUTPUT_TOKENS,
  type SearchSourcesAccessor,
} from "./tools/search-sources";
import { ToolRegistry } from "../tool-registry";
import { StubLlmAdapter, type LlmPort, type LlmRequest, type LlmResponse } from "../llm";
import type { SerializedItinerary } from "./tools/get-itinerary";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CHARS_PER_TOKEN = 4;

/** Fixture internal accessors (RAG + optional itinerary). */
function fakeAccessors(over: Partial<ResearcherAccessors> = {}) {
  const accessors: ResearcherAccessors = {
    embed: async () => [0.1, 0.2, 0.3],
    retrieve: async () => [
      "Kyoto: il quartiere di Gion è celebre per le geisha.",
      "La stagione del foliage cade a fine novembre.",
    ],
    ...over,
  };
  return { accessors };
}

/** A searchSources spy: records every call so OFF→zero can be proven. */
function spySearchSources() {
  const calls: Array<{ tenantId: string; query: string }> = [];
  const accessor: SearchSourcesAccessor = async (tenantId, input) => {
    calls.push({ tenantId, query: input.query });
    return {
      sources: [
        { title: "Kyoto travel guide", url: "https://example.com/kyoto", snippet: "Fatto esterno." },
      ],
    };
  };
  return { accessor, calls };
}

/** Captures the tool palette the runner advertised to the model. */
class CapturingLlm implements LlmPort {
  lastReq: LlmRequest | undefined;
  constructor(private readonly inner: LlmPort) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.lastReq = req;
    return this.inner.complete(req);
  }
}

const ITINERARY: SerializedItinerary = {
  title: "Giappone in autunno",
  stops: [
    { place: "Kyoto", notes: "templi" },
    { place: "Nara" },
  ],
};

describe("ResearcherAgent (Slice X1)", () => {
  it("flag OFF → a schema-valid ResearchBrief from INTERNAL sources only", async () => {
    const { accessors } = fakeAccessors({
      getItinerary: async () => ITINERARY,
    });
    const researcher = new ResearcherAgent({
      llm: new StubLlmAdapter({ scenario: "immediate-end-turn" }),
      accessors,
    });

    const brief = await researcher.run(
      { topic: "Cosa vedere a Kyoto", itineraryId: "abc", externalEnabled: false },
      { tenantId: TENANT },
    );

    expect(researchBriefSchema.safeParse(brief).success).toBe(true);
    // Internal facts: RAG chunks + itinerary stops; NO external sources.
    expect(brief.facts).toContain("Kyoto: il quartiere di Gion è celebre per le geisha.");
    expect(brief.facts.some((f) => f.includes("tappa: Kyoto"))).toBe(true);
    expect(brief.sources).toEqual([]);
    // The OFF brief names the disabled-external gap.
    expect(brief.gapsToFill.join(" ")).toContain("Ricerca esterna disattivata");
  });

  it("flag OFF → searchSources is NOT offered and is NEVER called (zero external calls)", async () => {
    const spy = spySearchSources();
    const { accessors } = fakeAccessors({ searchSources: spy.accessor });
    const llm = new CapturingLlm(new StubLlmAdapter({ scenario: "one-tool-then-end" }));
    const researcher = new ResearcherAgent({ llm, accessors });

    await researcher.run(
      { topic: "Cosa vedere a Kyoto", externalEnabled: false },
      { tenantId: TENANT },
    );

    // Cost-zero invariant: the external accessor was never invoked.
    expect(spy.calls).toHaveLength(0);
    // The external tool was not even advertised to the model.
    const toolIds = (llm.lastReq?.tools ?? []).map((t) => t.id);
    expect(toolIds).not.toContain(SEARCH_SOURCES_TOOL_ID);
  });

  it("flag ON → the external tool is offered, called, and its sources land in the brief", async () => {
    const spy = spySearchSources();
    const { accessors } = fakeAccessors({ searchSources: spy.accessor });
    const llm = new CapturingLlm(new StubLlmAdapter({ scenario: "immediate-end-turn" }));
    const researcher = new ResearcherAgent({ llm, accessors });

    const brief = await researcher.run(
      { topic: "Cosa vedere a Kyoto", externalEnabled: true },
      { tenantId: TENANT },
    );

    expect(researchBriefSchema.safeParse(brief).success).toBe(true);
    // The external accessor ran (pre-gather) under the right tenant.
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.tenantId).toBe(TENANT);
    // Its source surfaced in the brief.
    expect(brief.sources).toEqual([
      { title: "Kyoto travel guide", url: "https://example.com/kyoto" },
    ]);
    expect(brief.facts).toContain("Fatto esterno.");
    // The tool was advertised to the model too.
    const toolIds = (llm.lastReq?.tools ?? []).map((t) => t.id);
    expect(toolIds).toContain(SEARCH_SOURCES_TOOL_ID);
  });

  it("is deterministic: same topic (+ stub searchSources) → identical brief", async () => {
    const make = () =>
      new ResearcherAgent({
        llm: new StubLlmAdapter({ scenario: "immediate-end-turn" }),
        accessors: fakeAccessors().accessors,
      }).run({ topic: "Cosa vedere a Kyoto", externalEnabled: true }, { tenantId: TENANT });

    const a = await make();
    const b = await make();
    expect(a).toEqual(b);
  });

  it("rejects construction without exactly one LLM source", () => {
    const { accessors } = fakeAccessors();
    expect(() => new ResearcherAgent({ accessors })).toThrow(/exactly one/);
  });
});

// ── critica #5: searchSources output is TRUNCATED to maxOutputTokens before it
//    re-enters the loop transcript (verified via ToolRegistry.dispatch). ────────
describe("searchSources truncation (critica #5)", () => {
  it("truncates an oversize external result to maxOutputTokens before injection", async () => {
    // An accessor whose serialised output far exceeds the token budget.
    const huge = "x".repeat(SEARCH_SOURCES_MAX_OUTPUT_TOKENS * CHARS_PER_TOKEN * 4);
    const bloated: SearchSourcesAccessor = async () => ({
      sources: [{ title: "Big", url: "https://example.com/big", snippet: huge }],
    });
    const tool = createSearchSourcesTool(bloated);
    const registry = new ToolRegistry([tool]);

    const [result] = await registry.dispatch(
      [{ id: "c1", name: SEARCH_SOURCES_TOOL_ID, input: { query: "kyoto" } }],
      { tenantId: TENANT, agentId: "researcher", runId: "r1" },
    );

    const maxChars = SEARCH_SOURCES_MAX_OUTPUT_TOKENS * CHARS_PER_TOKEN;
    expect(result!.isError).toBe(false);
    expect(result!.content.length).toBe(maxChars); // truncated exactly to the cap
    expect(result!.content.length).toBeLessThan(huge.length); // strictly smaller than raw
  });
});
