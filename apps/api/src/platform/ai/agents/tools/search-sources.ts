import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `searchSources` — the ONLY `side:'external'` tool of the Researcher (agentic-plan
 * Slice X1). It reaches OUTSIDE the tenant's own data for web sources/facts.
 *
 * In CI/E2E it is a DETERMINISTIC STUB at the boundary ({@link STUB_SEARCH_SOURCES}):
 * no network, no API key, no non-determinism — exactly like the LLM/GA4/Search-Console
 * stubs. A real SERP port (with sandboxing + per-tenant rate-limit + its own ADR) is
 * DEBT-034, triggered when the first tenant turns external research on.
 *
 * `maxOutputTokens` is MANDATORY here (critica #5): a real search result can be
 * arbitrarily large, so `ToolRegistry.dispatchOne` truncates the serialised output
 * to this many tokens BEFORE it re-enters the loop transcript — capping the
 * context-window blow-up an unbounded external payload would otherwise cause.
 *
 * PLATFORM-PURE: it depends only on an injected accessor (a SERP port the caller
 * supplies, or the stub). No import toward `modules/*`/`verticals/*` — the kernel
 * boundary holds, same as `retrieveContext`.
 */

export const SEARCH_SOURCES_TOOL_ID = "searchSources";

/** Truncation budget for the (potentially large) external result. */
export const SEARCH_SOURCES_MAX_OUTPUT_TOKENS = 1_500;

export interface SearchedSource {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchSourcesInput {
  query: string;
}

export interface SearchSourcesOutput {
  sources: SearchedSource[];
}

export type SearchSourcesAccessor = (
  tenantId: string,
  input: { query: string },
) => Promise<SearchSourcesOutput>;

function isInput(v: unknown): v is SearchSourcesInput {
  return isObject(v) && typeof v.query === "string";
}

function isSource(v: unknown): v is SearchedSource {
  return (
    isObject(v) &&
    typeof v.title === "string" &&
    typeof v.url === "string" &&
    typeof v.snippet === "string"
  );
}

function isOutput(v: unknown): v is SearchSourcesOutput {
  return isObject(v) && Array.isArray(v.sources) && v.sources.every(isSource);
}

/**
 * Deterministic offline SERP stub: fixed, query-derived fake sources. No network,
 * no `Date.now()`/randomness — the same query always yields the same sources, so
 * a Researcher run replays identically (idempotency, agentic-plan X1). DEBT-034.
 */
export const STUB_SEARCH_SOURCES: SearchSourcesAccessor = async (_tenantId, input) => {
  const q = input.query.trim() || "viaggio";
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "viaggio";
  return {
    sources: [
      {
        title: `Guida essenziale: ${q}`,
        url: `https://stub.local/guide/${slug}`,
        snippet: `Panoramica di riferimento su "${q}" (fonte stub deterministica, DEBT-034).`,
      },
      {
        title: `Cosa sapere prima di partire — ${q}`,
        url: `https://stub.local/tips/${slug}`,
        snippet: `Consigli pratici e stagionalità per "${q}" (fonte stub deterministica).`,
      },
    ],
  };
};

export function createSearchSourcesTool(
  acc: SearchSourcesAccessor,
): ToolDefinition<SearchSourcesInput, SearchSourcesOutput> {
  return {
    id: SEARCH_SOURCES_TOOL_ID,
    description:
      "Cerca fonti web esterne (titolo, url, estratto) per arricchire la ricerca con fatti non presenti nei contenuti del tenant.",
    inputSchema: schema("searchSources input", isInput),
    outputSchema: schema("searchSources output", isOutput),
    tenantScoped: true,
    side: "external",
    maxOutputTokens: SEARCH_SOURCES_MAX_OUTPUT_TOKENS,
    stubArgs: () => ({ query: "destinazione di viaggio" }),
    execute: (input, ctx) => acc(ctx.tenantId, { query: input.query }),
  };
}
