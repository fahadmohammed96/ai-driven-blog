import { describe, it, expect } from "vitest";
import type { Block, Theme } from "@blogs/contracts";
import { emailDraftSchema } from "@blogs/contracts";
import {
  EmailAgent,
  brandVoiceScore,
  draftText,
  mergeSubjectPreheader,
  DEFAULT_EMAIL_BRAND_VOICE_THRESHOLD,
  type EmailAccessors,
} from "./email-agent";
import { projectToNewsletter } from "./tools/project-to-newsletter";
import { StubLlmAdapter, type LlmPort, type LlmRequest } from "../../../platform/ai/llm";
import type { AgentRunStore, RunEnvelope } from "../../../platform/ai/agent-run-store";

// Email Agent on the generic AgentRunner (Slice S3). Stub/spy LLM everywhere →
// zero cost. The biforcation is STRUCTURAL: path A never touches the port.

const TENANT = "11111111-1111-1111-1111-111111111111";
const ITEM = "22222222-2222-2222-2222-222222222222";

const ARTICLE = {
  title: "Tramonto sulla costa siciliana",
  blocks: [
    { type: "heading", level: 1, text: "Tramonto sulla costa siciliana" },
    {
      type: "paragraph",
      text: "Ho camminato lungo la spiaggia al tramonto, tra sapori, incontri e silenzi che porto con me.",
    },
    { type: "image", assetId: "33333333-3333-3333-3333-333333333333", alt: "Costa" },
  ] as Block[],
  link: "https://blog.test/articles/22222222-2222-2222-2222-222222222222",
};

const THEME: Theme = "viaggi";
const EMPTY_VOICE = { tone: "", audience: "" };
// Keywords absent from the (travel) draft → forces the LLM path.
const OFF_VOICE = { tone: "professionale tecnico giuridico", audience: "ingegneri avvocati" };

function fakeAccessors(
  brandVoice: { tone: string; audience: string },
  over: Partial<EmailAccessors> = {},
): EmailAccessors {
  return { brandVoice: async () => brandVoice, ...over };
}

/** A spy port that records every request and returns a fixed end_turn completion. */
function spyLlm(content = "{}"): { port: LlmPort; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const port: LlmPort = {
    complete: async (req) => {
      calls.push(req);
      return {
        content,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      };
    },
  };
  return { port, calls };
}

/** Minimal in-memory AgentRunStore so the replay branch is exercised. */
function memStore(): { store: AgentRunStore } {
  const rows = new Map<string, { id: string; createdAt: Date; envelope: RunEnvelope }>();
  return {
    store: {
      findByTaskId: async (tenantId, taskId) => {
        const r = rows.get(`${tenantId}:${taskId}`);
        return r
          ? {
              id: r.id,
              tenantId,
              agentName: "email",
              taskId,
              steps: 0,
              toolCalls: [],
              envelope: r.envelope,
              agentDefinitionVersion: "v1",
              createdAt: r.createdAt,
            }
          : null;
      },
      record: async (rec) => {
        rows.set(`${rec.tenantId}:${rec.taskId}`, {
          id: rec.id,
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          envelope: rec.envelope,
        });
      },
    },
  };
}

describe("brandVoiceScore (deterministic, pure)", () => {
  it("is 1 for an empty brand voice (nothing to satisfy → no LLM)", () => {
    const draft = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    expect(brandVoiceScore(draft, EMPTY_VOICE)).toBe(1);
  });

  it("is the same for the same input (determinism), below threshold for an off voice", () => {
    const draft = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    const a = brandVoiceScore(draft, OFF_VOICE);
    const b = brandVoiceScore(draft, OFF_VOICE);
    expect(a).toBe(b);
    expect(a).toBeLessThan(DEFAULT_EMAIL_BRAND_VOICE_THRESHOLD);
  });

  it("rewards a subject/body that echoes the brand voice", () => {
    const draft = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    const word = draftText(draft).toLowerCase().split(/[^\p{L}]+/u).find((w) => w.length >= 5)!;
    expect(brandVoiceScore(draft, { tone: word, audience: "" })).toBe(1);
  });
});

describe("projectToNewsletter (deterministic)", () => {
  it("produces a valid EmailDraft: subject = title, body = projection, cta = link", () => {
    const draft = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    expect(emailDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.subject).toBe(ARTICLE.title);
    expect(draft.theme).toBe(THEME);
    expect(draft.contentItemId).toBe(ITEM);
    expect(draft.ctaUrl).toBe(ARTICLE.link);
    expect(draft.body).toContain("<p>");
  });
});

describe("EmailAgent.run", () => {
  it("requires exactly one of { llm, provider }", () => {
    expect(() => new EmailAgent({ accessors: fakeAccessors(EMPTY_VOICE) } as never)).toThrow();
  });

  it("PATH A: score ≥ threshold → LlmPort.complete is NEVER called (structural)", async () => {
    const spy = spyLlm();
    const agent = new EmailAgent({ llm: spy.port, accessors: fakeAccessors(EMPTY_VOICE) });
    const proposal = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, theme: THEME },
      { tenantId: TENANT },
    );

    expect(spy.calls).toHaveLength(0); // the guarantee
    expect(proposal.type).toBe("email_draft");
    expect(proposal.agentId).toBe("email");
    expect(proposal.requiresHumanGate).toBe(true);
    expect(proposal.estimatedCostUsd).toBe(0);
    expect(emailDraftSchema.safeParse(proposal.payload).success).toBe(true);
    expect(proposal.payload.theme).toBe(THEME);
    expect(proposal.payload.contentItemId).toBe(ITEM);
  });

  it("PATH B: score < threshold → exactly ONE LLM step (balanced tier), valid output, body unchanged", async () => {
    const spy = spyLlm();
    const agent = new EmailAgent({ llm: spy.port, accessors: fakeAccessors(OFF_VOICE) });
    const projected = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    const proposal = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, theme: THEME },
      { tenantId: TENANT },
    );

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.model).toBe("balanced");
    expect(emailDraftSchema.safeParse(proposal.payload).success).toBe(true);
    // The body is the deterministic projection, never the LLM's.
    expect(proposal.payload.body).toBe(projected.body);
  });

  it("PATH B: applies the LLM's subject/preheader when it returns JSON (body stays projected)", async () => {
    const content = JSON.stringify({ subject: "Subject riscritto dal modello", preheader: "Anteprima" });
    const spy = spyLlm(content);
    const agent = new EmailAgent({ llm: spy.port, accessors: fakeAccessors(OFF_VOICE) });
    const projected = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    const { payload } = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, theme: THEME },
      { tenantId: TENANT },
    );
    expect(payload.subject).toBe("Subject riscritto dal modello");
    expect(payload.preheader).toBe("Anteprima");
    expect(payload.body).toBe(projected.body);
  });

  it("PATH B with the offline StubLlmAdapter → valid draft (deterministic fallback)", async () => {
    const agent = new EmailAgent({
      llm: new StubLlmAdapter({ scenario: "one-tool-then-end" }),
      accessors: fakeAccessors(OFF_VOICE),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, theme: THEME },
      { tenantId: TENANT },
    );
    expect(emailDraftSchema.safeParse(payload).success).toBe(true);
  });

  it("subject can differ per theme (LLM path, different stub mocks)", async () => {
    const a = new EmailAgent({ llm: spyLlm(JSON.stringify({ subject: "Estate al mare", preheader: "p" })).port, accessors: fakeAccessors(OFF_VOICE) });
    const b = new EmailAgent({ llm: spyLlm(JSON.stringify({ subject: "Borghi di montagna", preheader: "p" })).port, accessors: fakeAccessors(OFF_VOICE) });
    const pa = await a.run({ contentItemId: ITEM, article: ARTICLE, theme: "mare" }, { tenantId: TENANT });
    const pb = await b.run({ contentItemId: ITEM, article: ARTICLE, theme: "montagna" }, { tenantId: TENANT });
    expect(pa.payload.subject).not.toBe(pb.payload.subject);
    expect(pa.payload.theme).toBe("mare");
    expect(pb.payload.theme).toBe("montagna");
  });

  it("PATH A replay: same input → STABLE proposal id (staging dedup)", async () => {
    const { store } = memStore();
    const triggeredAt = new Date("2026-06-01T10:00:00.000Z");
    const mk = () => new EmailAgent({ llm: spyLlm().port, accessors: fakeAccessors(EMPTY_VOICE), store });
    const p1 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, theme: THEME },
      { tenantId: TENANT, triggeredAt },
    );
    const p2 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, theme: THEME },
      { tenantId: TENANT, triggeredAt },
    );
    expect(p2.id).toBe(p1.id);
  });

  it("PATH A: a different theme is NOT a replay (distinct task, correct output)", async () => {
    const { store } = memStore();
    const triggeredAt = new Date("2026-06-01T10:00:00.000Z");
    const mk = () => new EmailAgent({ llm: spyLlm().port, accessors: fakeAccessors(EMPTY_VOICE), store });
    const p1 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, theme: "mare" },
      { tenantId: TENANT, triggeredAt },
    );
    const p2 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, theme: "montagna" },
      { tenantId: TENANT, triggeredAt },
    );
    expect(p2.id).not.toBe(p1.id);
    expect(p1.payload.theme).toBe("mare");
    expect(p2.payload.theme).toBe("montagna");
  });
});

describe("mergeSubjectPreheader (pure)", () => {
  it("falls back to the projection on non-JSON content (body never changes)", () => {
    const projected = projectToNewsletter({ contentItemId: ITEM, ...ARTICLE }, THEME);
    const merged = mergeSubjectPreheader(projected, "prosa non-JSON dallo stub");
    expect(merged.subject).toBe(projected.subject);
    expect(merged.preheader).toBe(projected.preheader);
    expect(merged.body).toBe(projected.body);
  });
});
