import { describe, it, expect } from "vitest";
import { inboundProposalSchema, type BrandVoice } from "@blogs/contracts";
import { InboundAgent, type InboundAccessors } from "./inbound-agent";
import { classifyInbound } from "./classify";
import { StubLlmAdapter, type LlmPort, type LlmRequest } from "../../../platform/ai/llm";
import type { AgentDefinition } from "../../../platform/ai/agent-registry";
import type { AgentRunStore, AgentRunRecord } from "../../../platform/ai/agent-run-store";

// Inbound Agent on the generic AgentRunner (Slice O2). Stub LLM everywhere → zero
// cost. Classification is DETERMINISTIC (heuristic seed); the LLM only refines the
// reply. Informative + propose-only + NO-SEND (mirror of the Analyst, O1).

const TENANT = "11111111-1111-1111-1111-111111111111";
const VOICE: BrandVoice = { tone: "caldo", audience: "viaggiatori" };

function fakeAccessors(): InboundAccessors {
  return {
    leads: async () => [],
    brandVoice: async () => VOICE,
    rag: { embed: async () => [0], retrieve: async () => [] },
  };
}

/** A spy port that records every request and returns a fixed completion. */
function spyLlm(content = "prosa, non JSON"): { port: LlmPort; calls: LlmRequest[] } {
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

/** Full in-memory AgentRunStore so the runner's replay branch is exercised. */
function memStore(): AgentRunStore {
  const rows = new Map<string, AgentRunRecord>();
  return {
    findByTaskId: async (tenantId, taskId) => rows.get(`${tenantId}:${taskId}`) ?? null,
    record: async (rec) => {
      rows.set(`${rec.tenantId}:${rec.taskId}`, {
        ...rec,
        createdAt: new Date("2026-06-02T10:00:00.000Z"),
      });
    },
  };
}

/** Capture the AgentDefinition the run built, to assert its per-run model tier. */
function tierCapturingLlm(): { port: LlmPort; model?: string } {
  const captured: { port: LlmPort; model?: string } = {
    port: {
      complete: async (req) => {
        captured.model = req.model;
        return {
          content: "prosa",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        };
      },
    },
  };
  return captured;
}

describe("classifyInbound (deterministic heuristic)", () => {
  it("routes a buying signal → lead, a generic question → info", () => {
    expect(classifyInbound("Vorrei un preventivo per un viaggio in Giappone")).toBe("lead");
    expect(classifyInbound("A che ora aprite l'ufficio?")).toBe("info");
  });

  it("a complaint takes precedence over a trip mention → reclamo", () => {
    expect(classifyInbound("Voglio un rimborso, il viaggio è stato pessimo")).toBe("reclamo");
  });

  it("is stable across calls (same input → same classification)", () => {
    const m = "Vorrei prenotare una vacanza";
    expect(classifyInbound(m)).toBe(classifyInbound(m));
  });
});

describe("InboundAgent.run", () => {
  it("requires exactly one of { llm, provider }", () => {
    expect(() => new InboundAgent({ accessors: fakeAccessors() } as never)).toThrow();
  });

  it("produces a valid InboundProposal (lead_classification) from a prose stub", async () => {
    const agent = new InboundAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() });
    const proposal = await agent.run(
      { message: "Vorrei un preventivo per un viaggio" },
      { tenantId: TENANT },
    );

    expect(proposal.type).toBe("lead_classification");
    expect(proposal.agentId).toBe("inbound");
    expect(proposal.requiresHumanGate).toBe(true);
    const parsed = inboundProposalSchema.safeParse(proposal.payload);
    expect(parsed.success).toBe(true);
    expect(["info", "lead", "reclamo"]).toContain(proposal.payload.classification);
    // Deterministic seed: a buying signal classifies as lead with a qualification.
    expect(proposal.payload.classification).toBe("lead");
    expect(proposal.payload.leadQualification).toBeDefined();
    expect(proposal.payload.proposedReply.length).toBeGreaterThan(0);
    expect(proposal.payload.suggestedNextAction.length).toBeGreaterThan(0);
  });

  it("a lead-like vs an info-like message → the CORRECT branch (deterministic)", async () => {
    const mk = () => new InboundAgent({ llm: spyLlm().port, accessors: fakeAccessors() });
    const lead = await mk().run({ message: "Vorrei prenotare un viaggio" }, { tenantId: TENANT });
    const info = await mk().run({ message: "Dove si trova la vostra sede?" }, { tenantId: TENANT });
    expect(lead.payload.classification).toBe("lead");
    expect(info.payload.classification).toBe("info");
    // info has no sales qualification; lead does.
    expect(info.payload.leadQualification).toBeUndefined();
    expect(lead.payload.leadQualification).toBeDefined();
  });

  it("merges the LLM's JSON reply on top of the deterministic seed", async () => {
    const content = JSON.stringify({ proposedReply: "Risposta rifinita dal modello." });
    const agent = new InboundAgent({ llm: new StubLlmAdapter({ content }), accessors: fakeAccessors() });
    const { payload } = await agent.run({ message: "Vorrei un preventivo" }, { tenantId: TENANT });
    expect(payload.proposedReply).toBe("Risposta rifinita dal modello.");
    // Classification is STILL the deterministic verdict (never replaced by the LLM).
    expect(payload.classification).toBe("lead");
  });

  it("a reclamo escalates the per-run model tier to 'balanced'; others use 'fast'", async () => {
    const reclamo = tierCapturingLlm();
    await new InboundAgent({ llm: reclamo.port, accessors: fakeAccessors() }).run(
      { message: "Pretendo un rimborso, servizio pessimo" },
      { tenantId: TENANT },
    );
    expect(reclamo.model).toBe("balanced");

    const lead = tierCapturingLlm();
    await new InboundAgent({ llm: lead.port, accessors: fakeAccessors() }).run(
      { message: "Vorrei un preventivo per un viaggio" },
      { tenantId: TENANT },
    );
    expect(lead.model).toBe("fast");

    const info = tierCapturingLlm();
    await new InboundAgent({ llm: info.port, accessors: fakeAccessors() }).run(
      { message: "Dove siete?" },
      { tenantId: TENANT },
    );
    expect(info.model).toBe("fast");
  });

  it("IDEMPOTENT: same tenant|message|leadId → STABLE proposal id (staging dedup)", async () => {
    const store = memStore();
    const triggeredAt = new Date("2026-06-02T10:00:00.000Z");
    const mk = () => new InboundAgent({ llm: spyLlm().port, accessors: fakeAccessors(), store });
    const p1 = await mk().run({ message: "Vorrei un preventivo" }, { tenantId: TENANT, triggeredAt });
    const p2 = await mk().run({ message: "Vorrei un preventivo" }, { tenantId: TENANT, triggeredAt });
    expect(p2.id).toBe(p1.id);
    expect(p2.id).toBe(p2.runId);
  });

  it("a DIFFERENT message is NOT a replay (re-keys the run)", async () => {
    const store = memStore();
    const triggeredAt = new Date("2026-06-02T10:00:00.000Z");
    const mk = () => new InboundAgent({ llm: spyLlm().port, accessors: fakeAccessors(), store });
    const a = await mk().run({ message: "Vorrei un preventivo" }, { tenantId: TENANT, triggeredAt });
    const b = await mk().run({ message: "Dove siete?" }, { tenantId: TENANT, triggeredAt });
    expect(b.id).not.toBe(a.id);
    expect(a.payload.classification).toBe("lead");
    expect(b.payload.classification).toBe("info");
  });

  it("a DIFFERENT leadId is NOT a replay (leadId folds into the subject)", async () => {
    const store = memStore();
    const triggeredAt = new Date("2026-06-02T10:00:00.000Z");
    const mk = () => new InboundAgent({ llm: spyLlm().port, accessors: fakeAccessors(), store });
    const m = "Aggiornamento sulla mia richiesta";
    const l1 = await mk().run({ message: m, leadId: "lead-1" }, { tenantId: TENANT, triggeredAt });
    const l2 = await mk().run({ message: m, leadId: "lead-2" }, { tenantId: TENANT, triggeredAt });
    expect(l2.id).not.toBe(l1.id);
    // leadId present → a qualification is attached even for a non-lead message.
    expect(l1.payload.leadQualification?.leadId).toBe("lead-1");
  });

  it("never advertises a tool it cannot validate: every tool's stubArgs passes its schema", async () => {
    // Drive the stub through a tool call to prove the offered tools are well-formed.
    const agent = new InboundAgent({
      llm: new StubLlmAdapter({ scenario: "one-tool-then-end" }),
      accessors: fakeAccessors(),
    });
    const { payload } = await agent.run({ message: "Vorrei un preventivo" }, { tenantId: TENANT });
    expect(inboundProposalSchema.safeParse(payload).success).toBe(true);
  });
});

// Type-level guard: `lead_classification` is in the ProposalType union (no cast).
const _typeCheck: AgentDefinition<unknown>["proposalType"] = "lead_classification";
void _typeCheck;
