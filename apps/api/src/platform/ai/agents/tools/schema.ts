import type { SchemaLike } from "../../tools";

/**
 * Minimal `SchemaLike` builder from a type-guard predicate. `platform/ai` stays
 * decoupled from a validation library (see the note in `tools.ts`), so real
 * tools hand-roll their I/O guards here rather than pull in zod. The runner only
 * ever calls `safeParse`/`parse`.
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
