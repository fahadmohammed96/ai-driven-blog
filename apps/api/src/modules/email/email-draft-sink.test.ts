import { describe, it, expect } from "vitest";
import type { EmailDraft } from "@blogs/contracts";
import { composeHtml } from "./email-draft-sink";

// Bug #1 (S3 review): the newsletter HTML composed on approval must escape every
// agent/LLM-shaped field, so a crafted draft cannot inject markup or a
// `javascript:` link into the email that reaches subscribers. `body` is already
// escaped upstream (`blocksToHtml`); `preheader`/`ctaText`/`ctaUrl` are
// escaped/scheme-guarded here (the only divergence the review flagged).

function draft(over: Partial<EmailDraft> = {}): EmailDraft {
  return {
    contentItemId: "00000000-0000-0000-0000-000000000000",
    theme: "viaggi",
    subject: "Subject",
    preheader: "Anteprima",
    body: "<p>corpo</p>",
    ctaText: "Leggi l'articolo",
    ctaUrl: "https://blog.test/articles/x",
    ...over,
  };
}

describe("composeHtml escapes outbound newsletter HTML (S3 #1)", () => {
  it("escapes HTML-significant characters in the preheader", () => {
    const html = composeHtml(draft({ preheader: `"><script>alert(1)</script>` }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });

  it("escapes HTML-significant characters in the CTA text", () => {
    const html = composeHtml(draft({ ctaText: "Leggi <b>ora</b>" }));
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("neutralizes a javascript: CTA url to '#'", () => {
    const html = composeHtml(draft({ ctaUrl: "javascript:alert(1)" }));
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("keeps an http(s) CTA url but escapes an attribute breakout", () => {
    const html = composeHtml(draft({ ctaUrl: `https://evil.test/"><script>` }));
    // Still an https link (not neutralized to '#')…
    expect(html).toContain("https://evil.test/");
    // …but the quote that would break out of the href attribute is escaped,
    // so no raw tag survives.
    expect(html).not.toContain(`"><script>`);
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("passes a normal https CTA url through unchanged", () => {
    const html = composeHtml(draft({ ctaUrl: "https://blog.test/articles/x" }));
    expect(html).toContain('href="https://blog.test/articles/x"');
  });

  it("keeps the already-escaped body verbatim", () => {
    const html = composeHtml(draft({ body: "<h1>Titolo</h1>\n<p>Testo</p>" }));
    expect(html).toContain("<h1>Titolo</h1>");
    expect(html).toContain("<p>Testo</p>");
  });
});
