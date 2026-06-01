import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `retrieveContext` — the RAG tool (agentic-plan §4). PLATFORM-PURE: it depends
 * only on the pgvector `retrieve` + the embedder, both injected at the boundary
 * (the same `retrieve` the Writer's `generateDraft` already used). No import
 * toward `modules/*` or `verticals/*` — the kernel boundary holds.
 */

export const RETRIEVE_CONTEXT_TOOL_ID = "retrieveContext";

export interface RetrieveContextAccessor {
  embed(text: string): Promise<number[]>;
  retrieve(tenantId: string, embedding: number[], k: number): Promise<string[]>;
}

export interface RetrieveContextInput {
  query: string;
  k?: number;
}

export interface RetrieveContextOutput {
  chunks: string[];
}

const DEFAULT_K = 3;

function isInput(v: unknown): v is RetrieveContextInput {
  return (
    isObject(v) &&
    typeof v.query === "string" &&
    (v.k === undefined || typeof v.k === "number")
  );
}

function isOutput(v: unknown): v is RetrieveContextOutput {
  return isObject(v) && Array.isArray(v.chunks) && v.chunks.every((c) => typeof c === "string");
}

export function createRetrieveContextTool(
  acc: RetrieveContextAccessor,
): ToolDefinition<RetrieveContextInput, RetrieveContextOutput> {
  return {
    id: RETRIEVE_CONTEXT_TOOL_ID,
    description:
      "Recupera i passaggi più rilevanti dai contenuti del tenant (RAG) per ancorare la bozza alla voce e ai fatti dell'autore.",
    inputSchema: schema("retrieveContext input", isInput),
    outputSchema: schema("retrieveContext output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 2_000,
    stubArgs: () => ({ query: "contesto di viaggio", k: DEFAULT_K }),
    execute: async (input, ctx) => {
      const embedding = await acc.embed(input.query);
      const chunks = await acc.retrieve(ctx.tenantId, embedding, input.k ?? DEFAULT_K);
      return { chunks };
    },
  };
}
