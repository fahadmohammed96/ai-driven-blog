import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { LeadStatus, NotificationChannel } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import type { LlmClient } from "../../platform/ai/llm";
import { getTenantSettings } from "../settings";
import { nextLeadStatus } from "./lead-state";
import { draftProposal } from "./proposal";
import type { NotificationPort } from "./notification.port";
import { getLead, insertLead, type LeadRow, updateLead } from "./crm.repo";

export class LeadNotFoundError extends Error {
  constructor() {
    super("lead not found");
    this.name = "LeadNotFoundError";
  }
}
export class LeadDepositNotSetError extends Error {
  constructor() {
    super("lead has no deposit to collect (draft a proposal first)");
    this.name = "LeadDepositNotSetError";
  }
}
export class LeadDepositFailedError extends Error {
  constructor() {
    super("deposit could not be collected");
    this.name = "LeadDepositFailedError";
  }
}

export interface CrmDeps {
  db: Db;
  llm: LlmClient;
  payment: { collectDeposit: PaymentCollect };
  notification: NotificationPort;
}

type PaymentCollect = (req: {
  bookingId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
}) => Promise<{ paymentRef: string; status: "succeeded" | "failed" }>;

/** Generate an unguessable client-portal token. */
function newPortalToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface CreateLeadInput {
  tenantId: string;
  customerEmail: string;
  customerName?: string;
  channel: NotificationChannel;
  request: string;
}

/** Open an inbound custom-trip request (status `received`). */
export async function createLead(deps: CrmDeps, input: CreateLeadInput): Promise<LeadRow> {
  return withTenant(deps.db, input.tenantId, (tx) =>
    insertLead(tx, {
      tenantId: input.tenantId,
      customerEmail: input.customerEmail,
      customerName: input.customerName ?? null,
      channel: input.channel,
      request: input.request,
      portalToken: newPortalToken(),
    }),
  );
}

export interface DraftLeadInput {
  tenantId: string;
  leadId: string;
  depositCents: number;
  currency: string;
}

/**
 * Have the AI draft the proposal/offer for a lead (`received → ai_drafted`). Reads
 * the tenant's brand voice from Settings (DEBT-010 paid for this path) and calls
 * the LLM port (a stub in tests) *outside* the DB transaction. The draft is stored
 * but NOT sent — it waits for human approval (the inbound gate).
 */
export async function draftLeadProposal(deps: CrmDeps, input: DraftLeadInput): Promise<LeadRow> {
  // Step 1 — verify the lead is draftable and read the brand voice (RLS-scoped).
  const ctx = await withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) return null;
    // Guard the transition early so an illegal state throws before the LLM call.
    nextLeadStatus(lead.status as LeadStatus, "draftProposal");
    const settings = await getTenantSettings(tx);
    return { lead, voice: settings.brandVoice };
  });
  if (!ctx) throw new LeadNotFoundError();

  // Step 2 — draft through the LLM port (no DB tx held across the call).
  const proposal = await draftProposal({ llm: deps.llm }, { request: ctx.lead.request, voice: ctx.voice });

  // Step 3 — persist the proposal + offered deposit, moving to ai_drafted.
  return withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) throw new LeadNotFoundError();
    const status = nextLeadStatus(lead.status as LeadStatus, "draftProposal");
    return updateLead(tx, input.leadId, {
      status,
      proposal,
      depositCents: input.depositCents,
      currency: input.currency,
    });
  });
}

/**
 * The human-in-the-loop gate. Approve the AI draft and ONLY THEN route it to the
 * client: `ai_drafted → human_approved` (records the approval), then the proposal
 * is sent via the NotificationPort, then `human_approved → sent`. Because routing
 * lives between these two transitions, nothing reaches the client without a human
 * approval. Idempotent re-approval is rejected by the state machine.
 */
export async function approveAndSend(
  deps: CrmDeps,
  input: { tenantId: string; leadId: string },
): Promise<LeadRow> {
  // Step 1 — record the human approval (ai_drafted → human_approved).
  const approved = await withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) return null;
    const status = nextLeadStatus(lead.status as LeadStatus, "approve");
    return updateLead(tx, input.leadId, { status, approvedAt: sql`now()` });
  });
  if (!approved) throw new LeadNotFoundError();

  // Step 2 — route the approved proposal to the client (outside any DB tx).
  await deps.notification.notify({
    leadId: approved.id,
    channel: approved.channel as NotificationChannel,
    to: approved.customerEmail,
    kind: "proposal",
    body: approved.proposal ?? "",
  });

  // Step 3 — mark it sent (human_approved → sent).
  return withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) throw new LeadNotFoundError();
    const status = nextLeadStatus(lead.status as LeadStatus, "markSent");
    return updateLead(tx, input.leadId, { status, sentAt: sql`now()` });
  });
}

/** Reject the AI draft and send it back for a re-draft (`ai_drafted → received`). */
export async function rejectProposal(
  deps: CrmDeps,
  input: { tenantId: string; leadId: string },
): Promise<LeadRow> {
  const updated = await withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) return null;
    const status = nextLeadStatus(lead.status as LeadStatus, "reject");
    return updateLead(tx, input.leadId, { status });
  });
  if (!updated) throw new LeadNotFoundError();
  return updated;
}

/**
 * Collect the lead's deposit and confirm it. Three steps so a DB transaction is
 * never held across the (networked) payment call, mirroring commerce's payDeposit:
 *   1. `sent → deposit_pending` (idempotent: already-confirmed/delivered returns).
 *   2. `PaymentPort.collectDeposit` — the stub succeeds deterministically.
 *   3. `deposit_pending → confirmed`, recording the payment ref + confirmed time.
 */
export async function payLeadDeposit(
  deps: CrmDeps,
  input: { tenantId: string; leadId: string },
): Promise<LeadRow> {
  // Step 1 — move to deposit_pending (or short-circuit if already past payment).
  const pending = await withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) return { kind: "missing" as const };
    if (lead.status === "confirmed" || lead.status === "delivered") {
      return { kind: "already" as const, lead };
    }
    // The state machine is the authoritative gate (illegal state → 409) and is
    // checked before the deposit-presence guard.
    const status = nextLeadStatus(lead.status as LeadStatus, "requestDeposit");
    if (lead.depositCents == null || lead.depositCents <= 0) return { kind: "no_deposit" as const };
    const updated = await updateLead(tx, input.leadId, { status });
    return { kind: "pending" as const, lead: updated };
  });
  if (pending.kind === "missing") throw new LeadNotFoundError();
  if (pending.kind === "no_deposit") throw new LeadDepositNotSetError();
  if (pending.kind === "already") return pending.lead;

  // Step 2 — collect the deposit through the PaymentPort (no DB tx held here).
  const result = await deps.payment.collectDeposit({
    bookingId: pending.lead.id,
    amountCents: pending.lead.depositCents!,
    currency: pending.lead.currency,
    customerEmail: pending.lead.customerEmail,
  });
  if (result.status !== "succeeded") throw new LeadDepositFailedError();

  // Step 3 — confirm (idempotent if a concurrent call already confirmed).
  return withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) throw new LeadNotFoundError();
    if (lead.status === "confirmed" || lead.status === "delivered") return lead;
    const status = nextLeadStatus(lead.status as LeadStatus, "confirmPayment");
    return updateLead(tx, input.leadId, {
      status,
      paymentRef: result.paymentRef,
      confirmedAt: sql`now()`,
    });
  });
}

/**
 * Deliver the confirmed itinerary to the client (`confirmed → delivered`) and
 * route a final "itinerary ready" notification. The itinerary then becomes visible
 * in the client portal. Idempotent: re-delivering returns the lead without routing
 * a duplicate notification.
 */
export async function deliverItinerary(
  deps: CrmDeps,
  input: { tenantId: string; leadId: string },
): Promise<LeadRow> {
  const step = await withTenant(deps.db, input.tenantId, async (tx) => {
    const lead = await getLead(tx, input.leadId);
    if (!lead) return { kind: "missing" as const };
    if (lead.status === "delivered") return { kind: "already" as const, lead };
    const status = nextLeadStatus(lead.status as LeadStatus, "deliver");
    const updated = await updateLead(tx, input.leadId, { status, deliveredAt: sql`now()` });
    return { kind: "delivered" as const, lead: updated };
  });
  if (step.kind === "missing") throw new LeadNotFoundError();
  if (step.kind === "already") return step.lead;

  // Route the itinerary to the client (only on the real transition).
  await deps.notification.notify({
    leadId: step.lead.id,
    channel: step.lead.channel as NotificationChannel,
    to: step.lead.customerEmail,
    kind: "itinerary",
    body: step.lead.proposal ?? "",
  });
  return step.lead;
}
