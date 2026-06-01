import { describe, it, expect } from "vitest";
import { WriterAgent, type WriterAccessors } from "./writer-agent";
import {
  scoreAuthenticity,
  buildAuthenticityFeedbackHint,
  AUTHENTICITY_THRESHOLD,
} from "./tools/score-authenticity";
import { StubLlmAdapter, type LlmPort, type LlmRequest, type LlmResponse } from "../llm";
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
});
