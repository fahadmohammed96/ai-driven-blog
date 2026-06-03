/**
 * Public surface of the platform AI/LLM layer.
 *
 * Deliberately narrow (critica #14): callers depend on the PORT and the env
 * factory, never on a concrete adapter. `AnthropicLlmAdapter` / `StubLlmAdapter`
 * are intentionally NOT exported, so "import the adapter directly" can't be
 * mistaken for a supported path. The arch test (`ai-index.arch.test.ts`) pins
 * this surface.
 */

export { createLlmPortFromEnv as createLlmFromEnv } from "./llm";
export type {
  LlmPort,
  LlmRequest,
  LlmResponse,
  ModelTier,
  ToolDefinition,
} from "./llm";
