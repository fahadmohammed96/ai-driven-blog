import { z } from "zod";
import { currencySchema } from "./commerce";

/**
 * CRM custom-trip pipeline (Fase 3 — monetizzazione, motion "Su misura",
 * INBOUND/one-to-one). A **Lead** is an inbound custom-trip request that travels a
 * human-in-the-loop pipeline: `received → ai_drafted → human_approved → sent →
 * deposit_pending → confirmed → delivered`. The AI **drafts** the proposal/offer
 * (reusing `platform/ai`, stubbed at the LLM boundary) but it is NOT sent to the
 * client until a human **approves** (the inbound gate, ADR-0020). The deposit is
 * collected through the commerce **PaymentPort**; outbound client notifications
 * (WhatsApp/mail) go through a stubbed **NotificationPort**; the confirmed
 * itinerary is delivered to a tokenized **client portal** read view.
 */

/** A routing channel for outbound client notifications. */
export const notificationChannelSchema = z.enum(["email", "whatsapp"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** Open a custom-trip request (the inbound lead). */
export const createLeadSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().min(1).max(200).optional(),
  // How the client wants to be reached for the proposal/itinerary (default mail).
  channel: notificationChannelSchema.default("email"),
  // The free-form custom-trip request from the client.
  request: z.string().min(1).max(5000),
});
export type CreateLead = z.infer<typeof createLeadSchema>;

/**
 * Ask the AI to draft the proposal/offer for a lead. `depositCents` is the offer's
 * deposit ("acconto") the AI/human proposes — snapshotted onto the lead so the
 * PaymentPort can later collect it. The draft is stored but NOT sent (the gate).
 */
export const draftProposalSchema = z.object({
  depositCents: z.number().int().positive(),
  currency: currencySchema,
});
export type DraftProposal = z.infer<typeof draftProposalSchema>;

/** The lead pipeline states (state machine in the crm module). */
export const leadStatusSchema = z.enum([
  "received",
  "ai_drafted",
  "human_approved",
  "sent",
  "deposit_pending",
  "confirmed",
  "delivered",
  "cancelled",
]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/** A Lead as returned by the founder-facing CRM endpoints. */
export interface LeadView {
  id: string;
  customerEmail: string;
  customerName: string | null;
  channel: NotificationChannel;
  request: string;
  status: LeadStatus;
  /** The AI-drafted proposal/offer (null until drafted). */
  proposal: string | null;
  depositCents: number | null;
  currency: string;
  /** The PaymentPort reference once the deposit has been collected. */
  paymentRef: string | null;
  /** The tokenized client-portal path for this lead (`/portal/:token`). */
  portalToken: string;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
}

/**
 * The tokenized client-portal read view. The proposal/itinerary is revealed ONLY
 * once the lead is `delivered` (before that the client sees status only) — the
 * read-side half of the human-in-the-loop gate: nothing reaches the client until a
 * human has approved, the deposit is paid, and the itinerary is delivered.
 */
export interface PortalView {
  status: LeadStatus;
  customerName: string | null;
  /** The delivered itinerary/proposal — non-null only when `status === "delivered"`. */
  itinerary: string | null;
}
