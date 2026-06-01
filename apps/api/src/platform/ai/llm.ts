import Anthropic from "@anthropic-ai/sdk";
import { MODEL_IDS, type ModelTier } from "./model-registry";
import type {
  CacheableBlock,
  Message,
  StubScenario,
  ToolCall,
  ToolDefinition,
} from "./tools";

export type { ModelTier } from "./model-registry";
export type {
  CacheableBlock,
  Message,
  StubScenario,
  ToolCall,
  ToolContext,
  ToolDefinition,
  SchemaLike,
} from "./tools";

// ───────────────────────────────────────────────────────────────────────────
// LlmPort — the generalized boundary (tool-use, model tiering, structured ctx)
// ───────────────────────────────────────────────────────────────────────────

export interface LlmRequest {
  /** For metering + circuit-breaker (wired in R1-B). */
  tenantId: string;
  /** For audit + budget attribution. */
  agentId: string;
  /** Join key toward `ai_agent_runs` (wired in A1-core). */
  runId: string;
  model: ModelTier;
  /** System + brand voice. Cached (ephemeral) — see block-order note below. */
  system: CacheableBlock[];
  /** Optional tool palette -> enables the tool-use loop. Cached. */
  tools?: ToolDefinition[];
  /** Stable structured context (RAG, serialized itinerary). Cached. */
  cache?: CacheableBlock[];
  /** Dynamic loop transcript (history, tool results). NEVER cached. */
  messages: Message[];
  /** Hard cap on OUTPUT tokens for this call. */
  maxTokens: number;
}

export interface LlmResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export interface LlmPort {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/**
 * ARCHITECTURAL INVARIANT — BLOCK ORDER FOR PROMPT CACHING (Anthropic API).
 *
 * The Anthropic prompt cache keys on a *prefix*: everything up to (and
 * including) the block carrying `cache_control: ephemeral` is the cached
 * prefix, and a cache hit requires that prefix to be byte-identical to a prior
 * request. Therefore the conversation MUST be assembled in this exact order,
 * stable prefix first, volatile content last:
 *
 *     [ system(cached) , tools(cached) , rag_context(cached) , itinerary(cached) , …messages(dynamic, NEVER cached) ]
 *
 * The `cache_control: ephemeral` marker goes on the LAST block of the stable
 * prefix (the itinerary, or whatever the last cacheable block is). The dynamic
 * `messages` (loop history + tool results) follow and are never cached — they
 * change every step and would otherwise bust the prefix. Reordering or caching
 * a `messages` block silently collapses the cache hit rate and the cost savings
 * (~20k input tokens/job) it buys.
 */

// ───────────────────────────────────────────────────────────────────────────
// Anthropic adapter (production; not exercised in CI — no API key there)
// ───────────────────────────────────────────────────────────────────────────

const EPHEMERAL = { type: "ephemeral" } as const;

export class AnthropicLlmAdapter implements LlmPort {
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string } = {}) {
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    // Stable prefix, in the binding order documented above. The ephemeral
    // cache_control marker lands on the last block of the prefix.
    const cacheableText = [...req.system, ...(req.cache ?? [])];
    const system: Anthropic.TextBlockParam[] = cacheableText.map((b, i) => ({
      type: "text",
      text: b.text,
      ...(i === cacheableText.length - 1 ? { cache_control: EPHEMERAL } : {}),
    }));

    const tools: Anthropic.Tool[] | undefined = req.tools?.map((t, i) => ({
      name: t.id,
      description: t.description,
      // TODO(debt): DEBT-017 — permissive input schema until real tools
      // (A1-writer) carry a JSON Schema; the loop only runs against the stub
      // until then.
      input_schema: { type: "object" as const },
      ...(i === req.tools!.length - 1 ? { cache_control: EPHEMERAL } : {}),
    }));

    const message = await this.client.messages.create({
      model: MODEL_IDS[req.model],
      max_tokens: req.maxTokens,
      system,
      ...(tools && tools.length ? { tools } : {}),
      messages: toAnthropicMessages(req.messages),
    });

    const content = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls: ToolCall[] = message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
      stopReason:
        message.stop_reason === "tool_use"
          ? "tool_use"
          : message.stop_reason === "max_tokens"
            ? "max_tokens"
            : "end_turn",
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}

/** Map the port's transcript onto Anthropic message params. */
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "tool_result") {
      return {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId, content: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Stub adapter (CI/E2E — deterministic, zero-cost). Replays named scenarios.
// ───────────────────────────────────────────────────────────────────────────

const STUB_DRAFT =
  "Ho vissuto questa tappa con calma, lasciandomi sorprendere da ogni dettaglio e da ogni incontro.";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

/**
 * Deterministic offline port for environments without an API key. Drives the
 * three stop-reasons on demand. When it emits a tool call it builds the args
 * via the REAL tool's `stubArgs()`, so the call always passes the tool's own
 * `inputSchema.safeParse` — no malformed tool calls ever enter the loop.
 * INVARIANT: never touches the network, so CI/E2E never pays.
 */
export class StubLlmAdapter implements LlmPort {
  private readonly scenario: StubScenario;
  private readonly content: string;

  constructor(opts: { scenario?: StubScenario; content?: string } = {}) {
    this.scenario = opts.scenario ?? "immediate-end-turn";
    this.content = opts.content ?? STUB_DRAFT;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const endTurn = (): LlmResponse => ({
      content: this.content,
      stopReason: "end_turn",
      usage: { ...ZERO_USAGE },
    });
    const toolUse = (): LlmResponse => ({
      content: "",
      toolCalls: req.tools?.length ? [this.makeToolCall(req.tools[0]!)] : [],
      stopReason: "tool_use",
      usage: { ...ZERO_USAGE },
    });

    switch (this.scenario) {
      case "immediate-end-turn":
        return endTurn();
      case "one-tool-then-end":
        // First step asks for a tool; once a tool_result is in the transcript
        // the model "has what it needs" and finishes.
        return hasToolResult(req.messages) || !req.tools?.length
          ? endTurn()
          : toolUse();
      case "cycle-until-max":
        return toolUse();
    }
  }

  private makeToolCall(tool: ToolDefinition): ToolCall {
    return {
      id: `stub-${tool.id}`,
      name: tool.id,
      input: tool.stubArgs(),
    };
  }
}

function hasToolResult(messages: Message[]): boolean {
  return messages.some((m) => m.role === "tool_result");
}

/** Real Anthropic port when an API key is present, else the zero-cost stub. */
export function createLlmPortFromEnv(): LlmPort {
  return process.env.ANTHROPIC_API_KEY
    ? new AnthropicLlmAdapter()
    : new StubLlmAdapter();
}

// ───────────────────────────────────────────────────────────────────────────
// LEGACY seam — `LlmClient.complete({system, prompt}) -> string`.
//
// Still consumed by callers NOT migrated to the agentic port yet: the travel
// article generator, the CRM proposal flow, their controllers and the
// `infra.module` DI wiring (all out of scope for slice R1-A). Kept intact and
// untouched so existing journeys stay green. NOT re-exported from the public
// barrel. TODO(debt): DEBT-018 — unify this onto `LlmPort` as those callers
// become agents (A1-writer onward), at which point `createLlmFromEnv` retires.
// ───────────────────────────────────────────────────────────────────────────

export interface LlmInput {
  system: string;
  prompt: string;
}

export interface LlmClient {
  complete(input: LlmInput): Promise<string>;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
    this.model = opts.model ?? "claude-sonnet-4-6";
  }

  async complete(input: LlmInput): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: [
        { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: input.prompt }],
    });
    return message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
  }
}

export class StubLlmClient implements LlmClient {
  async complete(): Promise<string> {
    return STUB_DRAFT;
  }
}

/** Legacy factory for the not-yet-migrated callers (see legacy note above). */
export function createLlmFromEnv(): LlmClient {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicLlmClient() : new StubLlmClient();
}
