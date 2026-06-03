import { describe, it, expect } from "vitest";
import { InvalidLeadTransitionError, nextLeadStatus } from "./lead-state";

describe("lead pipeline state machine", () => {
  it("walks the full happy path received → … → delivered", () => {
    expect(nextLeadStatus("received", "draftProposal")).toBe("ai_drafted");
    expect(nextLeadStatus("ai_drafted", "approve")).toBe("human_approved");
    expect(nextLeadStatus("human_approved", "markSent")).toBe("sent");
    expect(nextLeadStatus("sent", "requestDeposit")).toBe("deposit_pending");
    expect(nextLeadStatus("deposit_pending", "confirmPayment")).toBe("confirmed");
    expect(nextLeadStatus("confirmed", "deliver")).toBe("delivered");
  });

  it("enforces the human gate: a draft cannot be sent without approval", () => {
    // From ai_drafted there is NO markSent — only approve (or reject/cancel).
    expect(() => nextLeadStatus("ai_drafted", "markSent")).toThrow(InvalidLeadTransitionError);
    // markSent is only reachable from human_approved.
    expect(nextLeadStatus("human_approved", "markSent")).toBe("sent");
  });

  it("reject loops a draft back to received for a re-draft", () => {
    expect(nextLeadStatus("ai_drafted", "reject")).toBe("received");
  });

  it("cancels any non-terminal lead, and treats delivered/cancelled as terminal", () => {
    expect(nextLeadStatus("received", "cancel")).toBe("cancelled");
    expect(nextLeadStatus("sent", "cancel")).toBe("cancelled");
    expect(() => nextLeadStatus("delivered", "cancel")).toThrow(InvalidLeadTransitionError);
    expect(() => nextLeadStatus("cancelled", "draftProposal")).toThrow(InvalidLeadTransitionError);
  });

  it("rejects nonsensical jumps (e.g. confirm before deposit, deliver before confirm)", () => {
    expect(() => nextLeadStatus("sent", "confirmPayment")).toThrow(InvalidLeadTransitionError);
    expect(() => nextLeadStatus("deposit_pending", "deliver")).toThrow(InvalidLeadTransitionError);
    expect(() => nextLeadStatus("received", "approve")).toThrow(InvalidLeadTransitionError);
  });
});
