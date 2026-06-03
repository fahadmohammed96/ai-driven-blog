import { describe, it, expect } from "vitest";
import { StubNotificationClient } from "./notification.stub";

describe("StubNotificationClient", () => {
  it("routes a notification, records it, and returns a deterministic per-channel ref", async () => {
    const stub = new StubNotificationClient();
    const res = await stub.notify({
      leadId: "lead-1",
      channel: "whatsapp",
      to: "+391112223333",
      kind: "proposal",
      body: "La tua proposta…",
    });
    expect(res).toEqual({ ref: "wa_stub_proposal_lead-1", status: "sent" });
    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0]!.kind).toBe("proposal");
  });

  it("uses a mail prefix for the email channel and is idempotent per lead+kind", async () => {
    const stub = new StubNotificationClient();
    const a = await stub.notify({ leadId: "L", channel: "email", to: "a@b.com", kind: "itinerary", body: "x" });
    const b = await stub.notify({ leadId: "L", channel: "email", to: "a@b.com", kind: "itinerary", body: "x" });
    expect(a.ref).toBe("mail_stub_itinerary_L");
    expect(b.ref).toBe(a.ref);
  });
});
