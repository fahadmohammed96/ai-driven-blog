/** A request to collect a booking deposit ("acconto") through a PaymentPort. */
export interface DepositRequest {
  /** The booking the deposit is for (used as the idempotency anchor). */
  bookingId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
}

/** The outcome of collecting a deposit. `paymentRef` is the provider intent id. */
export interface DepositResult {
  paymentRef: string;
  status: "succeeded" | "failed";
}

/**
 * Outbound payment seam (Fase 3, ADR-0023). The commerce domain depends on this
 * port, not on a payment provider. In production a Stripe **test-mode** adapter
 * lives behind config (`STRIPE_SECRET_KEY`); in tests a deterministic stub
 * implements it — no live Stripe, no real keys, no network. Mirrors the
 * `EmailPort` (Fase 2) / connector-stub (Fase 2.5) pattern.
 */
export interface PaymentPort {
  collectDeposit(req: DepositRequest): Promise<DepositResult>;
}
