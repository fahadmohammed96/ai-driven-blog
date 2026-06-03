import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getInternalLinkCandidates` — proposes related tenant items to link to
 * (agentic-plan §4, Slice S1). Intended to rank by pgvector similarity over
 * `content_embeddings`; the ranking itself is the INJECTED accessor's job so the
 * tool stays pure and unit-testable with a fake. The real accessor is wired by
 * the caller (the SEO controller, under the tenant's RLS scope).
 *
 * BOUNDARY: `content_items`/`content_embeddings` are read by the accessor the
 * caller supplies, exactly like the Writer's `retrieveContext` — the tool never
 * imports another module's internals. See DEBT-028 on the ranking signal.
 */

export const GET_INTERNAL_LINK_CANDIDATES_TOOL_ID = "getInternalLinkCandidates";

/** A candidate target the current item could link to. */
export interface InternalLinkCandidate {
  contentItemId: string;
  title: string;
}

/** Injected at the boundary: rank the tenant's other items by relevance to a query. */
export type InternalLinkCandidatesAccessor = (
  tenantId: string,
  query: string,
  k: number,
) => Promise<InternalLinkCandidate[]>;

export interface GetInternalLinkCandidatesInput {
  query: string;
  k?: number;
}

const DEFAULT_K = 3;

function isInput(v: unknown): v is GetInternalLinkCandidatesInput {
  return (
    isObject(v) &&
    typeof v.query === "string" &&
    (v.k === undefined || typeof v.k === "number")
  );
}

function isOutput(v: unknown): v is { candidates: InternalLinkCandidate[] } {
  return (
    isObject(v) &&
    Array.isArray(v.candidates) &&
    v.candidates.every(
      (c) => isObject(c) && typeof c.contentItemId === "string" && typeof c.title === "string",
    )
  );
}

export function createGetInternalLinkCandidatesTool(
  acc: InternalLinkCandidatesAccessor,
): ToolDefinition<GetInternalLinkCandidatesInput, { candidates: InternalLinkCandidate[] }> {
  return {
    id: GET_INTERNAL_LINK_CANDIDATES_TOOL_ID,
    description:
      "Restituisce i contenuti del tenant più affini al testo (per link interni), ordinati per similarità. Non include il contenuto corrente.",
    inputSchema: schema("getInternalLinkCandidates input", isInput),
    outputSchema: schema("getInternalLinkCandidates output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_000,
    stubArgs: () => ({ query: "viaggio", k: DEFAULT_K }),
    execute: async (input, ctx) => ({
      candidates: await acc(ctx.tenantId, input.query, input.k ?? DEFAULT_K),
    }),
  };
}
