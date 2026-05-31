import Link from "next/link";
import { PageHeader, StateBadge } from "../../../src/ui/components";
import { color, font, radius, shadow, space } from "../../../src/ui/tokens";
import { SURFACES } from "../surfaces";

/**
 * Hub home: the entry to the toolbox (ADR-0020 → ADR-0021). It orients the
 * founder across the 4 independent tools and states the operating model up front:
 * an AI agency PROPOSES, the human CONFIRMS — a toolbox, not a wizard. There is
 * no forced sequence: every tile/nav entry opens a tool directly, in any order.
 */
export default function HubHome() {
  return (
    <div data-testid="surface-hub">
      <PageHeader
        testId="hub-header"
        title="Content Hub"
        subtitle="La tua redazione AI: scegli uno strumento. Gli specialisti propongono, tu confermi."
      />

      {/* Operating model: the one idea that explains every surface. */}
      <section
        data-testid="hub-operating-model"
        style={{
          background: color.accentSoft,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          padding: space.lg,
          marginBottom: space.xl,
        }}
      >
        <strong style={{ display: "block", color: color.text, marginBottom: space.xs }}>
          L&apos;agenzia AI propone, tu confermi.
        </strong>
        <p style={{ margin: 0, color: color.textMuted }}>
          Uno staff di specialisti (scrittore, editor, SEO, social, email) propone il lavoro;
          tu lo <strong>approvi, modifichi o rifiuti</strong>. È sempre lo stesso gesto, su ogni
          strumento, sulla stessa macchina a stati di pubblicazione:
        </p>
        <div
          data-testid="hub-lifecycle"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginTop: space.md }}
        >
          {(["draft", "proposed", "review", "approved", "published"] as const).map((s, i) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: space.sm }}>
              {i > 0 && <span style={{ color: color.textMuted }} aria-hidden>→</span>}
              <StateBadge status={s} />
            </span>
          ))}
        </div>
        <p style={{ margin: `${space.md} 0 0`, color: color.textMuted, fontSize: font.size.sm }}>
          Una <strong>cassetta degli attrezzi, non una procedura guidata</strong>: apri gli
          strumenti nell&apos;ordine che vuoi. Il contrappeso è il misuratore di autenticità —
          l&apos;AI porta il mestiere, tu l&apos;esperienza vissuta e il giudizio finale.
        </p>
      </section>

      <h2 style={{ fontSize: font.size.lg, margin: `0 0 ${space.md}`, color: color.text }}>
        I tuoi strumenti
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: space.md,
        }}
      >
        {SURFACES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            data-testid={`tile-${s.navTestId}`}
            style={{
              display: "block",
              textDecoration: "none",
              color: color.text,
              background: color.surface,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
              boxShadow: shadow.card,
              padding: space.lg,
            }}
          >
            <strong style={{ display: "block", marginBottom: space.xs }}>{s.label}</strong>
            <span style={{ display: "block", color: color.textMuted }}>{s.hint}</span>
            <span style={{ display: "block", marginTop: space.md, color: color.accent, fontWeight: 600 }}>
              Apri →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
