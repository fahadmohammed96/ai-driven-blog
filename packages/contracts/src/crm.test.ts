import { describe, it, expect } from "vitest";
import {
  createLeadSchema,
  draftProposalSchema,
  leadStatusSchema,
  notificationChannelSchema,
} from "./crm";

describe("crm contracts", () => {
  it("validates an inbound lead: email + request, channel defaults to email", () => {
    const ok = createLeadSchema.safeParse({
      customerEmail: "ada@example.com",
      customerName: "Ada",
      request: "Vorrei un viaggio in Giappone in autunno, due settimane.",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.channel).toBe("email");

    // An empty request is rejected.
    expect(
      createLeadSchema.safeParse({ customerEmail: "ada@example.com", request: "" }).success,
    ).toBe(false);
    // A non-email customer is rejected.
    expect(createLeadSchema.safeParse({ customerEmail: "nope", request: "x" }).success).toBe(false);
  });

  it("validates a draft request: positive deposit, currency defaults to eur", () => {
    const ok = draftProposalSchema.safeParse({ depositCents: 30_000 });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.currency).toBe("eur");
    expect(draftProposalSchema.safeParse({ depositCents: 0 }).success).toBe(false);
  });

  it("validates the lead status enum and the notification channel enum", () => {
    expect(leadStatusSchema.safeParse("delivered").success).toBe(true);
    expect(leadStatusSchema.safeParse("paid").success).toBe(false);
    expect(notificationChannelSchema.safeParse("whatsapp").success).toBe(true);
    expect(notificationChannelSchema.safeParse("sms").success).toBe(false);
  });
});
