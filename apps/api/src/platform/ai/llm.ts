import Anthropic from "@anthropic-ai/sdk";

export interface LlmInput {
  system: string;
  prompt: string;
}

export interface LlmClient {
  complete(input: LlmInput): Promise<string>;
}

/**
 * Production adapter over the Anthropic SDK. Requires ANTHROPIC_API_KEY.
 * Not exercised in tests (the pipeline is tested with a fake at this boundary).
 */
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
      // Brand voice is stable across briefs -> cache it (prompt caching).
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
