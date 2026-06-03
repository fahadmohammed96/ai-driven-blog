import { describe, it, expect } from "vitest";
import { StubPaymentClient } from "./payment.stub";

describe("StubPaymentClient (deterministic deposit boundary)", () => {
  const payment = new StubPaymentClient();

  it("succeeds on a positive deposit with a payment ref derived from the booking id", async () => {
    const r = await payment.collectDeposit({
      bookingId: "abc-123",
      amountCents: 30_000,
      currency: "eur",
      customerEmail: "a@b.com",
    });
    expect(r.status).toBe("succeeded");
    expect(r.paymentRef).toBe("pi_stub_abc-123");
  });

  it("is deterministic: the same booking always yields the same payment ref (idempotent retry)", async () => {
    const req = { bookingId: "xyz", amountCents: 1_000, currency: "eur", customerEmail: "c@d.com" };
    const a = await payment.collectDeposit(req);
    const b = await payment.collectDeposit(req);
    expect(a).toEqual(b);
  });

  it("fails a non-positive deposit (still deterministic, no network)", async () => {
    const r = await payment.collectDeposit({
      bookingId: "zero",
      amountCents: 0,
      currency: "eur",
      customerEmail: "e@f.com",
    });
    expect(r.status).toBe("failed");
  });
});
