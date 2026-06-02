/**
 * HTML-output helpers shared by the email module's outbound rendering
 * (`render.ts`, the newsletter projector, the `email_draft` gate sink). Centralised
 * so every place that interpolates a value into outbound markup escapes it the
 * same way — the S3 review found the gate sink was the one path that diverged.
 */

/** Escape the HTML-significant characters (`& < > "`) for safe interpolation. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A safe `href` for outbound HTML: only `http(s)` URLs pass the scheme allowlist
 * (so `javascript:`/`data:`/etc. are neutralised to `#`), and the survivor is
 * still `escapeHtml`'d so a `"` can never break out of the attribute. Mirrors the
 * deterministic `ctaUrl` default (`#` when there is no canonical link).
 */
export function safeHref(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? escapeHtml(trimmed) : "#";
}
