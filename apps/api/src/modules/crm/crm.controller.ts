import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  createLeadSchema,
  draftProposalSchema,
  type LeadStatus,
  type LeadView,
  type NotificationChannel,
  type PortalView,
} from "@blogs/contracts";
import { DB, LLM, NOTIFICATION, PAYMENT } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import type { LlmClient } from "../../platform/ai/llm";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import type { PaymentPort } from "../commerce";
import type { NotificationPort } from "./notification.port";
import { getLeadByPortalToken, type LeadRow, listLeads } from "./crm.repo";
import { InvalidLeadTransitionError } from "./lead-state";
import {
  approveAndSend,
  createLead,
  type CrmDeps,
  deliverItinerary,
  draftLeadProposal,
  LeadDepositFailedError,
  LeadDepositNotSetError,
  LeadNotFoundError,
  payLeadDeposit,
  rejectProposal,
} from "./crm.service";

/**
 * CRM custom-trip surface (Fase 3, motion "Su misura" — INBOUND/one-to-one). A
 * lead travels the human-in-the-loop pipeline: it enters (`/leads`), the AI drafts
 * a proposal (`/draft`), a human approves it (`/approve` — the inbound gate; only
 * then is it routed to the client), the deposit is collected through the
 * PaymentPort (`/deposit`), and the confirmed itinerary is delivered (`/deliver`)
 * to a tokenized client portal (`/portal/:token`). Tenant-scoped behind the
 * tenancy guard + RLS. The portal lookup runs in the founder tenant context (n=1,
 * like the affiliate redirector / newsletter confirm link).
 */
@Controller()
export class CrmController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LLM) private readonly llm: LlmClient,
    @Inject(PAYMENT) private readonly payment: PaymentPort,
    @Inject(NOTIFICATION) private readonly notification: NotificationPort,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private get deps(): CrmDeps {
    return { db: this.db, llm: this.llm, payment: this.payment, notification: this.notification };
  }

  /** Map domain errors to HTTP. Illegal pipeline transitions → 409 Conflict. */
  private rethrow(err: unknown): never {
    if (err instanceof LeadNotFoundError) throw new NotFoundException("lead not found");
    if (err instanceof InvalidLeadTransitionError) throw new ConflictException(err.message);
    if (err instanceof LeadDepositNotSetError) throw new BadRequestException(err.message);
    if (err instanceof LeadDepositFailedError) throw new BadRequestException(err.message);
    throw err;
  }

  // ─── Founder-facing CRM inbox ─────────────────────────────────────────────

  @Post("leads")
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<LeadView> {
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const lead = await createLead(this.deps, {
      tenantId: this.tenantId,
      customerEmail: parsed.data.customerEmail,
      customerName: parsed.data.customerName,
      channel: parsed.data.channel,
      request: parsed.data.request,
    });
    return this.leadView(lead);
  }

  @Get("leads")
  async list(): Promise<{ leads: LeadView[] }> {
    const rows = await withTenant(this.db, this.tenantId, (tx) => listLeads(tx));
    return { leads: rows.map((r) => this.leadView(r)) };
  }

  @Get("leads/:id")
  async getOne(@Param("id") id: string): Promise<LeadView> {
    const rows = await withTenant(this.db, this.tenantId, (tx) => listLeads(tx));
    const lead = rows.find((r) => r.id === id);
    if (!lead) throw new NotFoundException("lead not found");
    return this.leadView(lead);
  }

  @Post("leads/:id/draft")
  @HttpCode(200)
  async draft(@Param("id") id: string, @Body() body: unknown): Promise<LeadView> {
    const parsed = draftProposalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const lead = await draftLeadProposal(this.deps, {
        tenantId: this.tenantId,
        leadId: id,
        depositCents: parsed.data.depositCents,
        currency: parsed.data.currency,
      });
      return this.leadView(lead);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post("leads/:id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string): Promise<LeadView> {
    try {
      const lead = await approveAndSend(this.deps, { tenantId: this.tenantId, leadId: id });
      return this.leadView(lead);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post("leads/:id/reject")
  @HttpCode(200)
  async reject(@Param("id") id: string): Promise<LeadView> {
    try {
      const lead = await rejectProposal(this.deps, { tenantId: this.tenantId, leadId: id });
      return this.leadView(lead);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post("leads/:id/deposit")
  @HttpCode(200)
  async deposit(@Param("id") id: string): Promise<LeadView> {
    try {
      const lead = await payLeadDeposit(this.deps, { tenantId: this.tenantId, leadId: id });
      return this.leadView(lead);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post("leads/:id/deliver")
  @HttpCode(200)
  async deliver(@Param("id") id: string): Promise<LeadView> {
    try {
      const lead = await deliverItinerary(this.deps, { tenantId: this.tenantId, leadId: id });
      return this.leadView(lead);
    } catch (err) {
      this.rethrow(err);
    }
  }

  // ─── Client portal (tokenized read view) ──────────────────────────────────

  @Get("portal/:token")
  async portal(@Param("token") token: string): Promise<PortalView> {
    const lead = await withTenant(this.db, this.tenantId, (tx) => getLeadByPortalToken(tx, token));
    if (!lead) throw new NotFoundException();
    const status = lead.status as LeadStatus;
    // The gate's read half: the itinerary is revealed ONLY once delivered.
    return {
      status,
      customerName: lead.customerName,
      itinerary: status === "delivered" ? lead.proposal : null,
    };
  }

  // ─── View ─────────────────────────────────────────────────────────────────

  private leadView(row: LeadRow): LeadView {
    return {
      id: row.id,
      customerEmail: row.customerEmail,
      customerName: row.customerName,
      channel: row.channel as NotificationChannel,
      request: row.request,
      status: row.status as LeadStatus,
      proposal: row.proposal,
      depositCents: row.depositCents,
      currency: row.currency,
      paymentRef: row.paymentRef,
      portalToken: row.portalToken,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    };
  }
}
