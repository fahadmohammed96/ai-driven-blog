import type { ToolCall, ToolContext, ToolDefinition } from "./tools";

/**
 * Minimal ToolRegistry.dispatch (agentic-plan §4) — enough for the generic
 * runner and its stub agent. The full registry with real, module-backed tools
 * arrives in A1-writer; this one only knows how to:
 *   1. resolve a `ToolCall` to its `ToolDefinition` by id,
 *   2. validate the model's args against `inputSchema` (a malformed call is
 *      surfaced as a `tool_result` error, never executed),
 *   3. execute under a `ToolContext` (the runner injects `tenantId` for
 *      tenant-scoped tools — RLS is already forced via `app_rw`),
 *   4. validate the output against `outputSchema`,
 *   5. truncate the serialised result to `maxOutputTokens` before it re-enters
 *      the loop (caps the context-window blow-up real tools can cause).
 *
 * A tool whose output carries `final: true` ends the loop (a terminal tool) —
 * the runner checks `DispatchResult.final`.
 */

export interface DispatchResult {
  toolCallId: string;
  toolName: string;
  /** Serialised, truncated tool output (or an error string for a bad call). */
  content: string;
  /** True when this result should terminate the loop. */
  final: boolean;
  /** True when args/output validation or execution failed (loop continues). */
  isError: boolean;
}

/** ~4 chars per token (same rough heuristic the runner uses for context size). */
const CHARS_PER_TOKEN = 4;

function truncateToTokens(text: string, maxOutputTokens: number | undefined): string {
  if (maxOutputTokens === undefined) return text;
  const maxChars = maxOutputTokens * CHARS_PER_TOKEN;
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function isFinal(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { final?: unknown }).final === true
  );
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
  }

  /**
   * Resolve an agent's `allowedTools` to their definitions — what the runner
   * passes as `LlmRequest.tools` (so the stub can build valid args via
   * `stubArgs()` and the real adapter can advertise the palette). Throws on an
   * unknown id: an agent allow-listing a tool that doesn't exist is a config bug.
   */
  resolve(ids: string[]): ToolDefinition[] {
    return ids.map((id) => {
      const tool = this.tools.get(id);
      if (!tool) throw new Error(`unknown tool in allowedTools: ${id}`);
      return tool;
    });
  }

  /**
   * Execute every requested tool call in order, returning one `tool_result`
   * payload per call. Errors are isolated per call: a bad call yields an error
   * result, the others still run.
   */
  async dispatch(toolCalls: ToolCall[], ctx: ToolContext): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const call of toolCalls) {
      results.push(await this.dispatchOne(call, ctx));
    }
    return results;
  }

  private async dispatchOne(call: ToolCall, ctx: ToolContext): Promise<DispatchResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        content: `error: unknown tool '${call.name}'`,
        final: false,
        isError: true,
      };
    }

    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        content: `error: invalid input for tool '${call.name}'`,
        final: false,
        isError: true,
      };
    }

    try {
      const output = await tool.execute(parsed.data, ctx);
      // Validate the tool's own output before it re-enters the transcript.
      tool.outputSchema.parse(output);
      return {
        toolCallId: call.id,
        toolName: call.name,
        content: truncateToTokens(JSON.stringify(output), tool.maxOutputTokens),
        final: isFinal(output),
        isError: false,
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        content: `error: tool '${call.name}' failed: ${(err as Error).message}`,
        final: false,
        isError: true,
      };
    }
  }
}
