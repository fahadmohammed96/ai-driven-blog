import { color, font, radius, space } from "../../src/ui/tokens";

/** Mirrors the platform AuthenticityReport flag shape (platform/ai). */
export interface AuthenticityFlag {
  suggestion: string;
  heading?: string;
  blockIndex?: number;
}

export interface AuthenticityScore {
  /** Share of substantial paragraphs that read as lived experience (0..1). */
  score: number;
  flags: AuthenticityFlag[];
}

/**
 * The authenticity meter — the counterweight to AI craft (ADR-0020): it surfaces
 * the experience score + nudges so the human keeps final judgment (E-E-A-T). It
 * is strictly *informational*: it never gates saving or publishing. Mirrors the
 * `{ score, flags }` the studio renders, as a reusable hub component.
 */
export function AuthenticityMeter({ score, flags }: AuthenticityScore) {
  const pct = Math.round(score * 100);
  const c = pct >= 70 ? color.approved : pct >= 40 ? color.review : color.danger;

  return (
    <aside
      data-testid="authenticity-meter"
      style={{
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        padding: space.lg,
        minWidth: 220,
        alignSelf: "flex-start",
      }}
    >
      <h2 style={{ fontSize: font.size.lg, margin: 0, color: color.text }}>Autenticità</h2>

      <div style={{ display: "flex", alignItems: "baseline", gap: space.xs, marginTop: space.sm }}>
        <span data-testid="meter-score" style={{ fontSize: "2rem", fontWeight: 700, color: c }}>
          {pct}%
        </span>
        <span style={{ color: color.textMuted, fontSize: font.size.sm }}>esperienza vissuta</span>
      </div>

      <div
        aria-hidden
        style={{
          height: 8,
          borderRadius: radius.sm,
          background: color.surfaceMuted,
          overflow: "hidden",
          margin: `${space.sm} 0`,
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: c }} />
      </div>

      {flags.length > 0 ? (
        <ul data-testid="meter-flags" style={{ margin: `${space.sm} 0 0`, paddingLeft: "1.1rem" }}>
          {flags.map((flag, i) => (
            <li key={i} style={{ color: color.review, fontSize: font.size.sm }}>
              {flag.heading ? `${flag.heading}: ` : ""}
              {flag.suggestion}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: color.textMuted, fontSize: font.size.sm, margin: `${space.sm} 0 0` }}>
          Nessuna sezione da arricchire.
        </p>
      )}

      <p style={{ color: color.textMuted, fontSize: "0.75rem", margin: `${space.md} 0 0` }}>
        Informativo — non blocca mai il salvataggio o la pubblicazione.
      </p>
    </aside>
  );
}
