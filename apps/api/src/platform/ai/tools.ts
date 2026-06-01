/**
 * Tool contract for the agentic LLM layer. Defined here (and not in `llm.ts`) so
 * the message/tool vocabulary the port speaks is independent of any adapter.
 *
 * NOTE on schema typing: tools validate their I/O with a schema, but `platform/ai`
 * must not take a hard dependency on a specific validation library. `SchemaLike`
 * is the structural subset we rely on — a Zod schema satisfies it out of the box,
 * so real tools (arriving in slice A1-writer) can pass their Zod schemas here
 * unchanged. The runner only ever calls `safeParse` / `parse`.
 */

export interface SchemaLike<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
  parse(input: unknown): T;
}

/** A cacheable text block (system, brand voice, tool defs, RAG, itinerary). */
export interface CacheableBlock {
  type: "text";
  text: string;
}

/**
 * One turn of the conversation transcript. `tool_result` carries a tool's output
 * back into the loop, joined to its originating call by `toolCallId`.
 */
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      role: "tool_result";
      toolCallId: string;
      toolName: string;
      content: string;
    };

/** A model-requested tool invocation. `input` is validated against the tool's schema. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Injected by the runner; `tenantScoped` tools rely on `tenantId` for RLS. */
export interface ToolContext {
  tenantId: string;
  agentId: string;
  runId: string;
}

/**
 * A typed, side-classified tool. `read`/`draft` only — nothing publishes, sends,
 * or writes live state without a human gate (propose-only is structural).
 */
export interface ToolDefinition<TIn = unknown, TOut = unknown> {
  id: string;
  description: string;
  inputSchema: SchemaLike<TIn>;
  outputSchema: SchemaLike<TOut>;
  /** When true the runner injects `tenantId` (RLS already enforced via app_rw). */
  tenantScoped: boolean;
  side: "read" | "draft" | "external";
  /** Truncate the tool result to this many tokens before re-injecting it. */
  maxOutputTokens?: number;
  /** Minimal VALID args for the stub adapter — MUST pass `inputSchema.safeParse`. */
  stubArgs(): TIn;
  execute(input: TIn, ctx: ToolContext): Promise<TOut>;
}

/** Stable, named scenarios the stub adapter can replay deterministically. */
export type StubScenario =
  | "immediate-end-turn"
  | "one-tool-then-end"
  | "cycle-until-max";
