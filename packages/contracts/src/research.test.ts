import { describe, it, expect } from "vitest";
import { researchSourceSchema, researchBriefSchema } from "./research";

// FIX 2 (X1 review — lezione S3 XSS): `ResearchSource.url` feeds an `<a href>` on
// the proposals card. `z.string().url()` ALONE accepts `javascript:`/`data:` URLs
// (the URL constructor does), so the contract must scheme-guard to http(s) — the
// same defence the S3 email fix took with `safeHref`.
describe("researchSourceSchema — url scheme guard (output-safety)", () => {
  it("rejects a javascript: URL", () => {
    expect(
      researchSourceSchema.safeParse({ title: "x", url: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("rejects a data: URL", () => {
    expect(
      researchSourceSchema.safeParse({ title: "x", url: "data:text/html,<script>1</script>" })
        .success,
    ).toBe(false);
  });

  it("accepts an https URL", () => {
    expect(researchSourceSchema.safeParse({ title: "x", url: "https://ok.tld" }).success).toBe(
      true,
    );
  });

  it("accepts an http URL", () => {
    expect(researchSourceSchema.safeParse({ title: "x", url: "http://ok.tld/p" }).success).toBe(
      true,
    );
  });

  it("a brief carrying a javascript: source URL fails to parse", () => {
    const brief = {
      facts: [],
      sources: [{ title: "bad", url: "javascript:alert(1)" }],
      keyInsights: [],
      gapsToFill: [],
      rationale: "r",
    };
    expect(researchBriefSchema.safeParse(brief).success).toBe(false);
  });
});
