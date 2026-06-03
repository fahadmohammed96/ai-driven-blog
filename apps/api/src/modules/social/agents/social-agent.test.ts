import { describe, it, expect } from "vitest";
import type { Block, Channel } from "@blogs/contracts";
import { channelPostMapSchema } from "@blogs/contracts";
import {
  SocialAgent,
  brandVoiceScore,
  postText,
  DEFAULT_BRAND_VOICE_THRESHOLD,
  NoProducibleChannelsError,
  type SocialAccessors,
} from "./social-agent";
import { projectChannels } from "./tools/project-to-social";
import type { ArticleContent } from "../repurpose";
import { StubLlmAdapter, type LlmPort, type LlmRequest } from "../../../platform/ai/llm";
import type { AgentRunStore, RunEnvelope } from "../../../platform/ai/agent-run-store";

// Social Agent on the generic AgentRunner (Slice S2). Stub/spy LLM everywhere →
// zero cost. The biforcation is STRUCTURAL: path A never touches the port.

const TENANT = "11111111-1111-1111-1111-111111111111";
const ITEM = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

const ARTICLE: ArticleContent = {
  title: "Tramonto sulla costa siciliana",
  blocks: [
    { type: "heading", level: 1, text: "Tramonto sulla costa siciliana" },
    {
      type: "paragraph",
      text: "Ho camminato lungo la spiaggia al tramonto, tra sapori, incontri e silenzi che porto con me.",
    },
    { type: "image", assetId: ASSET, alt: "Costa" },
  ] as Block[],
};

const ALL_CHANNELS: Channel[] = ["instagram", "x", "pinterest"];
const EMPTY_VOICE = { tone: "", audience: "" };
// Keywords absent from the (travel) captions → forces the LLM path.
const OFF_VOICE = { tone: "professionale tecnico giuridico", audience: "ingegneri avvocati" };

function fakeAccessors(
  brandVoice: { tone: string; audience: string },
  channels: Channel[] = ALL_CHANNELS,
  over: Partial<SocialAccessors> = {},
): SocialAccessors {
  return { brandContext: async () => ({ brandVoice, channels }), ...over };
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

/** Minimal in-memory AgentRunStore so the path-A replay branch is exercised. */
function memStore(): { store: AgentRunStore } {
  const rows = new Map<string, { id: string; createdAt: Date; envelope: RunEnvelope }>();
  return {
    store: {
      findByTaskId: async (tenantId, taskId) => rows.get(`${tenantId}:${taskId}`) ?? null,
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
    const posts = projectChannels(ARTICLE, ["instagram"]);
    expect(brandVoiceScore(posts, EMPTY_VOICE)).toBe(1);
  });

  it("is the same for the same input (determinism)", () => {
    const posts = projectChannels(ARTICLE, ALL_CHANNELS);
    const a = brandVoiceScore(posts, OFF_VOICE);
    const b = brandVoiceScore(posts, OFF_VOICE);
    expect(a).toBe(b);
    expect(a).toBeLessThan(DEFAULT_BRAND_VOICE_THRESHOLD);
  });

  it("rewards captions that echo the brand voice", () => {
    const posts = projectChannels(ARTICLE, ["instagram"]);
    const corpus = postText(posts[0]!).toLowerCase();
    // Build a voice whose keywords are literally present in the caption.
    const word = corpus.split(/[^\p{L}]+/u).find((w) => w.length >= 5)!;
    expect(brandVoiceScore(posts, { tone: word, audience: "" })).toBe(1);
  });
});

describe("SocialAgent.run", () => {
  it("requires exactly one of { llm, provider }", () => {
    expect(() => new SocialAgent({ accessors: fakeAccessors(EMPTY_VOICE) } as never)).toThrow();
  });

  it("PATH A: score ≥ threshold → LlmPort.complete is NEVER called (structural)", async () => {
    const spy = spyLlm();
    const agent = new SocialAgent({ llm: spy.port, accessors: fakeAccessors(EMPTY_VOICE) });
    const proposal = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, channels: ALL_CHANNELS },
      { tenantId: TENANT },
    );

    expect(spy.calls).toHaveLength(0); // the guarantee
    expect(proposal.type).toBe("social_captions");
    expect(proposal.agentId).toBe("social");
    expect(proposal.requiresHumanGate).toBe(true);
    expect(proposal.estimatedCostUsd).toBe(0);
    expect(channelPostMapSchema.safeParse(proposal.payload).success).toBe(true);
    expect(proposal.payload.posts.map((p) => p.channel).sort()).toEqual([
      "instagram",
      "pinterest",
      "x",
    ]);
    expect(proposal.payload.contentItemId).toBe(ITEM);
  });

  it("PATH B: score < threshold → exactly ONE LLM step per channel, valid output", async () => {
    const spy = spyLlm();
    const channels: Channel[] = ["instagram", "pinterest"];
    const agent = new SocialAgent({ llm: spy.port, accessors: fakeAccessors(OFF_VOICE) });
    const proposal = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, channels },
      { tenantId: TENANT },
    );

    // One step per channel (the merge does not add calls).
    expect(spy.calls).toHaveLength(channels.length);
    // Tier per channel: fast for instagram, balanced for pinterest.
    expect(spy.calls[0]!.model).toBe("fast");
    expect(spy.calls[1]!.model).toBe("balanced");
    expect(channelPostMapSchema.safeParse(proposal.payload).success).toBe(true);
    expect(proposal.payload.posts.map((p) => p.channel)).toEqual(channels);
  });

  it("PATH B: applies the LLM's caption when it returns JSON", async () => {
    const content = JSON.stringify({ caption: "Caption riscritta dal modello", hashtags: ["#viaggio"] });
    const spy = spyLlm(content);
    const agent = new SocialAgent({ llm: spy.port, accessors: fakeAccessors(OFF_VOICE) });
    const { payload } = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, channels: ["instagram"] },
      { tenantId: TENANT },
    );
    const ig = payload.posts.find((p) => p.channel === "instagram")!;
    expect(ig.channel).toBe("instagram");
    if (ig.channel === "instagram") {
      expect(ig.caption).toBe("Caption riscritta dal modello");
      expect(ig.hashtags).toEqual(["#viaggio"]);
    }
  });

  it("PATH B with the offline StubLlmAdapter → valid posts (deterministic fallback)", async () => {
    const agent = new SocialAgent({
      llm: new StubLlmAdapter({ scenario: "one-tool-then-end" }),
      accessors: fakeAccessors(OFF_VOICE),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, channels: ["instagram"] },
      { tenantId: TENANT },
    );
    expect(channelPostMapSchema.safeParse(payload).success).toBe(true);
  });

  it("only emits channels in the request ∩ the tenant's enabled channels", async () => {
    const spy = spyLlm();
    // Requested: instagram + x; enabled: instagram only → x is dropped.
    const agent = new SocialAgent({
      llm: spy.port,
      accessors: fakeAccessors(EMPTY_VOICE, ["instagram"]),
    });
    const { payload } = await agent.run(
      { contentItemId: ITEM, article: ARTICLE, channels: ["instagram", "x"] },
      { tenantId: TENANT },
    );
    expect(payload.posts.map((p) => p.channel)).toEqual(["instagram"]);
  });

  it("throws when no requested∩enabled channel can be produced", async () => {
    const agent = new SocialAgent({
      llm: spyLlm().port,
      accessors: fakeAccessors(EMPTY_VOICE, ["x"]),
    });
    await expect(
      agent.run(
        { contentItemId: ITEM, article: ARTICLE, channels: ["instagram"] },
        { tenantId: TENANT },
      ),
    ).rejects.toBeInstanceOf(NoProducibleChannelsError);
  });

  it("PATH A: same-day re-suggest with DIFFERENT channels does NOT replay the first call's channels", async () => {
    const { store } = memStore();
    const triggeredAt = new Date("2026-06-01T10:00:00.000Z");
    const mk = () => new SocialAgent({ llm: spyLlm().port, accessors: fakeAccessors(EMPTY_VOICE), store });
    const p1 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, channels: ["instagram"] },
      { tenantId: TENANT, triggeredAt },
    );
    expect(p1.payload.posts.map((p) => p.channel)).toEqual(["instagram"]);
    const p2 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, channels: ALL_CHANNELS },
      { tenantId: TENANT, triggeredAt },
    );
    // The channel set is part of task identity → NOT a replay of the 1-channel payload.
    expect(p2.payload.posts.map((p) => p.channel).sort()).toEqual(["instagram", "pinterest", "x"]);
  });

  it("PATH A: same-day re-suggest with the SAME channels replays with a STABLE proposal id (staging dedup)", async () => {
    const { store } = memStore();
    const triggeredAt = new Date("2026-06-01T10:00:00.000Z");
    const mk = () => new SocialAgent({ llm: spyLlm().port, accessors: fakeAccessors(EMPTY_VOICE), store });
    const p1 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, channels: ["instagram"] },
      { tenantId: TENANT, triggeredAt },
    );
    const p2 = await mk().run(
      { contentItemId: ITEM, article: ARTICLE, channels: ["instagram"] },
      { tenantId: TENANT, triggeredAt },
    );
    // Stable id across replays → persist's onConflictDoNothing(id) dedupes the staged proposal.
    expect(p2.id).toBe(p1.id);
  });
});
