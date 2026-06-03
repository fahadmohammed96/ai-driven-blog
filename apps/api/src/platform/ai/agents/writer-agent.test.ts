import { describe, it, expect } from "vitest";
import { WriterAgent, type WriterAccessors } from "./writer-agent";
import {
  scoreAuthenticity,
  buildAuthenticityFeedbackHint,
  AUTHENTICITY_THRESHOLD,
} from "./tools/score-authenticity";
import { StubLlmAdapter, type LlmPort, type LlmRequest, type LlmResponse } from "../llm";
import { ProviderRegistry, LLM_ANTHROPIC_CONNECTOR } from "../provider-registry";
import { InMemoryCredentialStore } from "../../integration";
import {
  GET_FEEDBACK_SIGNAL_TOOL_ID,
  type GetFeedbackSignalAccessor,
} from "./tools/get-feedback-signal";
import type { AnalyticsDashboard } from "@blogs/contracts";
import type { BrandVoice } from "../prompt";

// ── test doubles ────────────────────────────────────────────────────────────

const TENANT = "11111111-1111-1111-1111-111111111111";
const VOICE: BrandVoice = { tone: "entusiasta", audience: "foodie viaggiatori" };

/** A first-person draft (passes the authenticity gate). */
const PERSONAL_DRAFT =
  "Ho vissuto questa tappa con calma, lasciandomi sorprendere da ogni dettaglio e da ogni incontro.";
/** A generic draft with no first-person voice (fails the authenticity gate). */
const GENERIC_DRAFT =
  "Questo articolo descrive una destinazione turistica con informazioni pratiche e consigli utili per organizzare la visita.";

/** Records every embed/retrieve call so a test can prove the tool ran too. */
function fakeAccessors(over: Partial<WriterAccessors> = {}) {
  const embeds: string[] = [];
  const retrieves: Array<{ tenantId: string; k: number }> = [];
  const accessors: WriterAccessors = {
    embed: async (text) => {
      embeds.push(text);
      return [0.1, 0.2, 0.3];
    },
    retrieve: async (tenantId, _embedding, k) => {
      retrieves.push({ tenantId, k });
      return ["Tokyo ramen guide: best bowls in Shinjuku."];
    },
    ...over,
  };
  return { accessors, embeds, retrieves };
}

/** Counts round-trips and captures the last request the runner composed. */
class CapturingLlm implements LlmPort {
  calls = 0;
  lastReq: LlmRequest | undefined;
  constructor(private readonly inner: LlmPort) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    this.lastReq = req;
    return this.inner.complete(req);
  }
}

const userMessages = (req: LlmRequest | undefined): string =>
  req?.messages.filter((m) => m.role === "user").map((m) => (m as { content: string }).content).join("\n") ??
  "";

// ── scoreAuthenticity (pure, extracted from the Phase-1 meter) ───────────────

describe("scoreAuthenticity", () => {
  it("scores a first-person draft above threshold and a generic one below", () => {
    expect(scoreAuthenticity(PERSONAL_DRAFT)).toBeGreaterThanOrEqual(AUTHENTICITY_THRESHOLD);
    expect(scoreAuthenticity(GENERIC_DRAFT)).toBeLessThan(AUTHENTICITY_THRESHOLD);
  });

  it("builds a deterministic feedback hint", () => {
    const hint = buildAuthenticityFeedbackHint(0);
    expect(hint).toBe(buildAuthenticityFeedbackHint(0));
    expect(hint.length).toBeGreaterThan(0);
  });
});

// ── WriterAgent ──────────────────────────────────────────────────────────────

describe("WriterAgent", () => {
  it("produces a non-empty content_draft proposal in ≤ maxSteps (early-exit, no tool call)", async () => {
    const { accessors, retrieves } = fakeAccessors();
    const llm = new CapturingLlm(new StubLlmAdapter({ scenario: "immediate-end-turn" }));
    const writer = new WriterAgent({ llm, accessors });

    const proposal = await writer.run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    expect(llm.calls).toBe(1); // content without a tool-call → early exit
    expect(proposal.payload.draft.length).toBeGreaterThan(0);
    expect(proposal.payload.usedContext).toEqual([
      "Tokyo ramen guide: best bowls in Shinjuku.",
    ]);
    expect(proposal.payload.system).toContain("entusiasta");
    expect(proposal.type).toBe("content_draft");
    expect(proposal.agentId).toBe("writer");
    expect(proposal.requiresHumanGate).toBe(true);
    expect(proposal.status).toBe("pending");
    expect(proposal.truncated).toBe(false);
    // The prompt carries the retrieved context + the brief (backward compat).
    expect(userMessages(llm.lastReq)).toContain("Tokyo ramen guide");
    expect(userMessages(llm.lastReq)).toContain("cibo in Giappone");
    // Exactly one pre-retrieval (no tool call this run).
    expect(retrieves).toHaveLength(1);
    expect(retrieves[0]!.tenantId).toBe(TENANT);
  });

  it("when the model asks for retrieveContext, the tool runs, then the second step produces the draft", async () => {
    const { accessors, retrieves } = fakeAccessors();
    const llm = new CapturingLlm(new StubLlmAdapter({ scenario: "one-tool-then-end" }));
    const writer = new WriterAgent({ llm, accessors });

    const proposal = await writer.run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    expect(llm.calls).toBe(2); // tool step + draft step
    expect(proposal.payload.draft.length).toBeGreaterThan(0);
    expect(proposal.truncated).toBe(false);
    // Two retrievals: one pre-injected for backward compat + one from the tool.
    expect(retrieves).toHaveLength(2);
  });

  it("authenticity gate below threshold → exactly ONE extra iteration with the hint, then accepts (no identical loop)", async () => {
    const { accessors } = fakeAccessors();
    const llm = new CapturingLlm(
      new StubLlmAdapter({ scenario: "immediate-end-turn", content: GENERIC_DRAFT }),
    );
    const writer = new WriterAgent({ llm, accessors });

    const proposal = await writer.run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    expect(llm.calls).toBe(2); // one rejection (hint appended) + one acceptance — never more
    expect(proposal.payload.draft).toBe(GENERIC_DRAFT);
    expect(proposal.truncated).toBe(false);
    // The deterministic authenticity hint was appended for the retry.
    expect(userMessages(llm.lastReq)).toContain(buildAuthenticityFeedbackHint(0));
  });

  it("a first-person draft passes the gate on the first end_turn (no retry)", async () => {
    const { accessors } = fakeAccessors();
    const llm = new CapturingLlm(
      new StubLlmAdapter({ scenario: "immediate-end-turn", content: PERSONAL_DRAFT }),
    );
    const writer = new WriterAgent({ llm, accessors });

    const proposal = await writer.run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    expect(llm.calls).toBe(1);
    expect(proposal.payload.draft).toBe(PERSONAL_DRAFT);
  });

  it("R1-C: sources its LlmPort from a ProviderRegistry, resolved per tenant", async () => {
    const { accessors } = fakeAccessors();
    const store = new InMemoryCredentialStore();
    await store.save(TENANT, LLM_ANTHROPIC_CONNECTOR, {
      accessToken: "sk-tenant-key",
      refreshToken: "byok-no-refresh",
      expiresAt: 0,
    });
    const seenKeys: string[] = [];
    const tenantPort = new CapturingLlm(
      new StubLlmAdapter({ scenario: "immediate-end-turn", content: PERSONAL_DRAFT }),
    );
    const provider = new ProviderRegistry({
      store,
      anthropicFactory: (apiKey) => {
        seenKeys.push(apiKey);
        return tenantPort;
      },
      platformFactory: () => {
        throw new Error("platform key must not be used when a tenant key exists");
      },
    });
    const writer = new WriterAgent({ provider, accessors });

    const proposal = await writer.run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    // The Writer ran against the tenant's own key, not the platform key.
    expect(seenKeys).toEqual(["sk-tenant-key"]);
    expect(tenantPort.calls).toBe(1);
    expect(proposal.payload.draft).toBe(PERSONAL_DRAFT);
    expect(proposal.agentId).toBe("writer");
  });

  it("rejects construction without exactly one LLM source", () => {
    const { accessors } = fakeAccessors();
    expect(() => new WriterAgent({ accessors })).toThrow(/exactly one/);
  });
});

// ── WriterAgent — feedback loop (Slice A2) ───────────────────────────────────

const CONTENT_ITEM = "22222222-2222-2222-2222-222222222222";

/**
 * A dashboard where pinterest clearly out-engages instagram, so the derived
 * signal/prompt-hint mentions "pinterest" (and deprioritises instagram).
 */
const FEEDBACK_DASHBOARD: AnalyticsDashboard = {
  rows: [],
  bySource: [],
  byChannel: [
    { channel: "pinterest", metrics: [{ source: "ga4", metric: "sessions", value: 500 }] },
    { channel: "instagram", metrics: [{ source: "ga4", metric: "sessions", value: 40 }] },
  ],
  ingestedAt: null,
};

/** A fixture feedback accessor that records the content ids it was asked about. */
function fakeFeedbackAccessor(dashboard: AnalyticsDashboard) {
  const calls: string[] = [];
  const accessor: GetFeedbackSignalAccessor = async (_tenantId, contentItemId) => {
    calls.push(contentItemId);
    return dashboard;
  };
  return { accessor, calls };
}

/**
 * A model double that calls `getFeedbackSignal` when offered it, then weaves the
 * returned hint into the draft — so the with-hint draft differs from the baseline.
 */
class FeedbackAwareLlm implements LlmPort {
  calls = 0;
  feedbackCalls = 0;
  lastSignalResult: string | undefined;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const hasFeedbackTool =
      req.tools?.some((t) => t.id === GET_FEEDBACK_SIGNAL_TOOL_ID) ?? false;
    const feedbackResult = req.messages.find(
      (m): m is Extract<typeof m, { role: "tool_result" }> =>
        m.role === "tool_result" && m.toolName === GET_FEEDBACK_SIGNAL_TOOL_ID,
    );
    if (hasFeedbackTool && !feedbackResult) {
      this.feedbackCalls++;
      return {
        content: "",
        toolCalls: [
          { id: "call-fb", name: GET_FEEDBACK_SIGNAL_TOOL_ID, input: { contentItemId: CONTENT_ITEM } },
        ],
        stopReason: "tool_use",
        usage,
      };
    }
    // end_turn — incorporate the signal (kept on one first-person paragraph so the
    // authenticity gate still passes, i.e. no extra retry obscures the assertions).
    if (feedbackResult) this.lastSignalResult = feedbackResult.content;
    const hint = feedbackResult ? ` Adatto il taglio al segnale: ${feedbackResult.content}` : "";
    return { content: PERSONAL_DRAFT + hint, stopReason: "end_turn", usage };
  }
}

describe("WriterAgent — feedback loop (Slice A2)", () => {
  it("stand-alone: the model calls getFeedbackSignal; the signal comes back and the draft adapts (≠ no-hint draft)", async () => {
    const fbWith = fakeFeedbackAccessor(FEEDBACK_DASHBOARD);
    const { accessors: accWith } = fakeAccessors({ getFeedbackSignal: fbWith.accessor });
    const llmWith = new FeedbackAwareLlm();
    const withHint = await new WriterAgent({ llm: llmWith, accessors: accWith }).run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE, contentItemId: CONTENT_ITEM },
      { tenantId: TENANT },
    );

    const fbWithout = fakeFeedbackAccessor(FEEDBACK_DASHBOARD);
    const { accessors: accWithout } = fakeAccessors({ getFeedbackSignal: fbWithout.accessor });
    const llmWithout = new FeedbackAwareLlm();
    const noHint = await new WriterAgent({ llm: llmWithout, accessors: accWithout }).run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    // The tool ran once and the derived signal (mentioning the top channel) came back.
    expect(llmWith.feedbackCalls).toBe(1);
    expect(fbWith.calls).toEqual([CONTENT_ITEM]);
    expect(llmWith.lastSignalResult).toContain("pinterest");
    // No contentItemId → the tool was never offered → never called.
    expect(llmWithout.feedbackCalls).toBe(0);
    expect(fbWithout.calls).toHaveLength(0);
    // The hint observably changed the draft.
    expect(withHint.payload.draft).not.toBe(noHint.payload.draft);
    expect(withHint.payload.draft).toContain("pinterest");
  });

  it("a feedback signal already pre-injected in the brief → tool NOT offered, zero feedback calls", async () => {
    const fb = fakeFeedbackAccessor(FEEDBACK_DASHBOARD);
    const { accessors } = fakeAccessors({ getFeedbackSignal: fb.accessor });
    const llm = new CapturingLlm(
      new StubLlmAdapter({ scenario: "immediate-end-turn", content: PERSONAL_DRAFT }),
    );
    await new WriterAgent({ llm, accessors }).run(
      {
        brief: "Scrivi sul cibo in Giappone",
        voice: VOICE,
        contentItemId: CONTENT_ITEM,
        feedbackHint: "Favorisci contenuti per il canale \"pinterest\".",
      },
      { tenantId: TENANT },
    );

    const toolIds = (llm.lastReq?.tools ?? []).map((t) => t.id);
    expect(toolIds).not.toContain(GET_FEEDBACK_SIGNAL_TOOL_ID);
    expect(fb.calls).toHaveLength(0);
  });

  it("no contentItemId → feedback tool NOT offered", async () => {
    const fb = fakeFeedbackAccessor(FEEDBACK_DASHBOARD);
    const { accessors } = fakeAccessors({ getFeedbackSignal: fb.accessor });
    const llm = new CapturingLlm(
      new StubLlmAdapter({ scenario: "immediate-end-turn", content: PERSONAL_DRAFT }),
    );
    await new WriterAgent({ llm, accessors }).run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE },
      { tenantId: TENANT },
    );

    const toolIds = (llm.lastReq?.tools ?? []).map((t) => t.id);
    expect(toolIds).not.toContain(GET_FEEDBACK_SIGNAL_TOOL_ID);
    expect(fb.calls).toHaveLength(0);
  });

  it("integration: run with a valid contentItemId + fixture accessor completes without error", async () => {
    const fb = fakeFeedbackAccessor(FEEDBACK_DASHBOARD);
    const { accessors } = fakeAccessors({ getFeedbackSignal: fb.accessor });
    const llm = new StubLlmAdapter({ scenario: "one-tool-then-end", content: PERSONAL_DRAFT });
    const proposal = await new WriterAgent({ llm, accessors }).run(
      { brief: "Scrivi sul cibo in Giappone", voice: VOICE, contentItemId: CONTENT_ITEM },
      { tenantId: TENANT },
    );

    expect(proposal.payload.draft.length).toBeGreaterThan(0);
    expect(proposal.type).toBe("content_draft");
    expect(proposal.requiresHumanGate).toBe(true);
  });
});
