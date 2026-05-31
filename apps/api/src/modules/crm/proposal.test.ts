import { describe, it, expect } from "vitest";
import type { LlmInput } from "../../platform/ai/llm";
import { buildProposalPrompt, draftProposal, renderProposalSystemPrompt } from "./proposal";

describe("crm proposal drafting", () => {
  it("renders the system prompt from the tenant's brand voice", () => {
    const sys = renderProposalSystemPrompt({ tone: "ironico", audience: "famiglie" });
    expect(sys).toContain("Tono: ironico.");
    expect(sys).toContain("Cliente: famiglie.");
    expect(sys).toContain("L'AI propone, l'umano conferma");
  });

  it("falls back to sane defaults when the brand voice is empty", () => {
    const sys = renderProposalSystemPrompt({ tone: "", audience: "" });
    expect(sys).toContain("caldo e professionale");
    expect(sys).toContain("viaggiatori che cercano un viaggio su misura");
  });

  it("embeds the client request in the user prompt", () => {
    expect(buildProposalPrompt("Giappone in autunno")).toContain("Giappone in autunno");
  });

  it("drafts through the LLM port, passing the voice system + request prompt", async () => {
    const seen: LlmInput[] = [];
    const llm = {
      async complete(input: LlmInput) {
        seen.push(input);
        return "Ecco la tua proposta di viaggio su misura.";
      },
    };
    const draft = await draftProposal({ llm }, { request: "Patagonia", voice: { tone: "avventuroso", audience: "trekker" } });
    expect(draft).toBe("Ecco la tua proposta di viaggio su misura.");
    expect(seen[0]!.system).toContain("avventuroso");
    expect(seen[0]!.prompt).toContain("Patagonia");
  });
});
