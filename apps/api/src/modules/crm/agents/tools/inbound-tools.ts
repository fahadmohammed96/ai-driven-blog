import type { BrandVoice } from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import type { LeadRow } from "../../crm.repo";
import { classifyInbound } from "../classify";
import { schema, isObject } from "./schema";

/**
 * Inbound Agent tools (Slice O2) — all `side:'read'`, with a `maxOutputTokens`
 * cap so a tool result is truncated before re-injection (cost control §5). The
 * `classifyInbound` tool is DETERMINISTIC (the same pure heuristic the agent's
 * seed uses → stable in CI). Data tools read the tenant's leads / brand voice via
 * accessors injected at the boundary (the controller supplies the RLS-scoped
 * readers), so `modules/crm` never reaches another module's internals.
 */

/** Injected at the boundary: read the tenant's leads (RLS-scoped). */
export type LeadsAccessor = (tenantId: string) => Promise<LeadRow[]>;
/** Injected at the boundary: read the tenant's brand voice (RLS-scoped). */
export type BrandVoiceAccessor = (tenantId: string) => Promise<BrandVoice>;

export const CLASSIFY_INBOUND_TOOL_ID = "classifyInbound";
export const GET_LEADS_TOOL_ID = "getLeads";
export const GET_TENANT_SETTINGS_TOOL_ID = "getTenantSettings";
export const GET_BOOKINGS_TOOL_ID = "getBookings";

interface ClassifyInboundInput {
  message: string;
}

function isClassifyInput(v: unknown): v is ClassifyInboundInput {
  return isObject(v) && typeof v.message === "string";
}

/**
 * `classifyInbound`: the DETERMINISTIC keyword/pattern triage (info/lead/reclamo).
 * TODO(debt): DEBT-039 — heuristic, not the real Haiku classifier; trigger = the
 * first real inbound signal in production.
 */
export function createClassifyInboundTool(): ToolDefinition<ClassifyInboundInput> {
  return {
    id: CLASSIFY_INBOUND_TOOL_ID,
    description:
      "Classifica DETERMINISTICAMENTE un messaggio inbound in 'info' | 'lead' | 'reclamo' (euristica per parole chiave). Nessun ricalcolo dal modello.",
    inputSchema: schema("classifyInbound input", isClassifyInput),
    outputSchema: schema("classifyInbound output", isObject),
    tenantScoped: false,
    side: "read",
    maxOutputTokens: 200,
    stubArgs: () => ({ message: "Vorrei un preventivo per un viaggio." }),
    execute: async (input) => ({ classification: classifyInbound(input.message) }),
  };
}

/** Project a lead row to the compact summary the model needs (no PII overload). */
function leadSummary(row: LeadRow): {
  id: string;
  status: string;
  channel: string;
  request: string;
} {
  return {
    id: row.id,
    status: row.status,
    channel: row.channel,
    request: row.request.slice(0, 200),
  };
}

/** `getLeads`: the tenant's existing pipeline leads (compact summaries). */
export function createGetLeadsTool(acc: LeadsAccessor): ToolDefinition {
  return {
    id: GET_LEADS_TOOL_ID,
    description:
      "Restituisce i lead esistenti del tenant (sintesi: id, stato, canale, richiesta) per agganciare un segnale inbound a un lead già in pipeline.",
    inputSchema: schema("getLeads input", isObject),
    outputSchema: schema("getLeads output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_500,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({
      leads: (await acc(ctx.tenantId)).map(leadSummary),
    }),
  };
}

/** `getTenantSettings`: the tenant's brand voice (tone) for the reply draft. */
export function createGetTenantSettingsTool(acc: BrandVoiceAccessor): ToolDefinition {
  return {
    id: GET_TENANT_SETTINGS_TOOL_ID,
    description:
      "Restituisce la brand voice del tenant (tono, pubblico) per calibrare il tono della risposta proposta.",
    inputSchema: schema("getTenantSettings input", isObject),
    outputSchema: schema("getTenantSettings output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 500,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({ brandVoice: await acc(ctx.tenantId) }),
  };
}

/**
 * `getBookings`: STUB — no commerce read wired yet (accessing the commerce module
 * for this triage is heavy and out of scope for O2).
 * TODO(debt): DEBT-039 — returns an empty stub; trigger = the first real inbound
 * signal in production (then wire a real bookings accessor).
 */
export function createGetBookingsTool(): ToolDefinition {
  return {
    id: GET_BOOKINGS_TOOL_ID,
    description:
      "Restituisce le prenotazioni recenti del cliente (STUB: vuoto, DEBT-039) per contestualizzare un segnale inbound.",
    inputSchema: schema("getBookings input", isObject),
    outputSchema: schema("getBookings output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 300,
    stubArgs: () => ({}),
    execute: async () => ({ bookings: [], note: "stub (DEBT-039)" }),
  };
}
