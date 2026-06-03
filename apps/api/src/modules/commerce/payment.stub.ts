import type { DepositRequest, DepositResult, PaymentPort } from "./payment.port";

/**
 * Deterministic in-memory PaymentPort for dev/CI: a valid positive deposit
 * always *succeeds*, and the payment reference is a pure function of the booking
 * id (`pi_stub_<bookingId>`) so a retried collection is idempotent and tests can
 * assert it exactly. No network, no keys — the boundary stub, exactly like the
 * Mailhog/connector stubs of earlier phases.
 */
export class StubPaymentClient implements PaymentPort {
  async collectDeposit(req: DepositRequest): Promise<DepositResult> {
    const paymentRef = `pi_stub_${req.bookingId}`;
    // A non-positive amount can never be charged → deterministic failure.
    const status: DepositResult["status"] = req.amountCents > 0 ? "succeeded" : "failed";
    return { paymentRef, status };
  }
}

/**
 * Build the PaymentPort from env. Always returns the deterministic stub for now.
 * TODO(debt): DEBT-011 — a real Stripe (test-mode) adapter behind
 * `STRIPE_SECRET_KEY` (PaymentIntent create + webhook-driven confirmation) is not
 * implemented; wiring live Stripe is a founder follow-up (ADR-0023).
 */
export function createPaymentFromEnv(): PaymentPort {
  return new StubPaymentClient();
}
