import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getSerpSnapshot` — a snapshot of how a keyword currently ranks on a search
 * engine (agentic-plan §4, Slice S1). STUB in CI: there is no real SERP API
 * integration. Behind a per-tenant feature flag a real provider would back this;
 * until then it returns an empty, explicitly-stubbed snapshot so the loop is
 * deterministic and zero-cost.
 *
 * TODO(debt): DEBT-027 — `getSerpSnapshot` is a stub (no real SERP ranking).
 */

export const GET_SERP_SNAPSHOT_TOOL_ID = "getSerpSnapshot";

export interface SerpResult {
  position: number;
  title: string;
  url: string;
}

export interface GetSerpSnapshotInput {
  keyword: string;
}

export interface GetSerpSnapshotOutput {
  keyword: string;
  /** Empty + `stubbed:true` until a real SERP provider is wired (DEBT-027). */
  results: SerpResult[];
  stubbed: boolean;
}

function isInput(v: unknown): v is GetSerpSnapshotInput {
  return isObject(v) && typeof v.keyword === "string";
}

function isOutput(v: unknown): v is GetSerpSnapshotOutput {
  return (
    isObject(v) &&
    typeof v.keyword === "string" &&
    Array.isArray(v.results) &&
    typeof v.stubbed === "boolean"
  );
}

/**
 * Build the SERP tool. `live` is reserved for the feature-flagged real provider;
 * with no provider (the only path today) it returns the stubbed empty snapshot.
 */
export function createGetSerpSnapshotTool(
  live?: (keyword: string) => Promise<SerpResult[]>,
): ToolDefinition<GetSerpSnapshotInput, GetSerpSnapshotOutput> {
  return {
    id: GET_SERP_SNAPSHOT_TOOL_ID,
    description:
      "Restituisce uno snapshot del ranking della parola chiave sui motori di ricerca. Stub in CI (nessun ranking reale).",
    inputSchema: schema("getSerpSnapshot input", isInput),
    outputSchema: schema("getSerpSnapshot output", isOutput),
    tenantScoped: false,
    // External by nature; a real provider would call the network behind a flag.
    side: "external",
    // Mandatory for an external tool (cost control §3 — truncate before injecting).
    maxOutputTokens: 1_000,
    stubArgs: () => ({ keyword: "viaggio" }),
    execute: async (input) => {
      if (!live) return { keyword: input.keyword, results: [], stubbed: true };
      return { keyword: input.keyword, results: await live(input.keyword), stubbed: false };
    },
  };
}
