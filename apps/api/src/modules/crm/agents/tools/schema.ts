import type { SchemaLike } from "../../../../platform/ai/tools";

/**
 * Minimal `SchemaLike` builder from a type-guard predicate — the crm module's
 * local copy of the convention the platform tools use (mirrors
 * `modules/analytics/agents/tools/schema.ts`). Kept local so `modules/crm` stays
 * self-contained; the runner only ever calls `safeParse`/`parse`.
 */
export function schema<T>(
  name: string,
  validate: (input: unknown) => input is T,
): SchemaLike<T> {
  return {
    safeParse: (input) =>
      validate(input)
        ? { success: true, data: input }
        : { success: false, error: `invalid ${name}` },
    parse: (input) => {
      if (!validate(input)) throw new Error(`invalid ${name}`);
      return input;
    },
  };
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
