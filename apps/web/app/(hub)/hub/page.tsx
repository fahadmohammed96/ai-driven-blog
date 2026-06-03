import Link from "next/link";
import { PageHeader, StateBadge, SectionTitle, Card } from "../../../src/ui/components";
import { color, font, gradient, radius, shadow, space } from "../../../src/ui/tokens";
import { GROUP_LABEL, SURFACES, type SurfaceGroup } from "../surfaces";

/**
 * Hub home: the entry to the toolbox (ADR-0020 → ADR-0021). It orients the
 * founder across the independent tools and states the operating model up front:
 * an AI agency PROPOSES, the human CONFIRMS — a toolbox, not a wizard. Every
 * tile opens a tool directly, in any order.
 */
const GROUP_ORDER: SurfaceGroup[] = ["create", "grow", "operate"];

const LIFECYCLE = ["draft", "proposed", "review", "approved", "published"] as const;

export default function HubHome() {
  return (
    <div data-testid="surface-hub">
      <PageHeader
        testId="hub-header"
        eyebrow="La tua redazione AI"
        title="Content Hub"
        subtitle="Scegli uno strumento. Gli specialisti propongono, tu confermi."
      />

      {/* Operating model: the one idea that explains every surface. */}
      <section
        data-testid="hub-operating-model"
        style={{
          position: "relative",
          overflow: "hidden",
          background: gradient.brand,
          borderRadius: radius.xl,
          padding: space.xl,
          marginBottom: space.xl,
          color: "#fff",
          boxShadow: shadow.lg,
        }}
      >
        <strong style={{ display: "block", fontSize: font.size.lg, marginBottom: space.sm }}>
          L&apos;agenzia AI propone, tu confermi.
        </strong>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.88)", maxWidth: "62ch", lineHeight: font.lineHeight.normal }}>
          Uno staff di specialisti (scrittore, editor, SEO, social, email) propone il lavoro;
          tu lo <strong>approvi, modifichi o rifiuti</strong>. È sempre lo stesso gesto, su ogni
          strumento, sulla stessa macchina a stati di pubblicazione:
        </p>
        <div
          data-testid="hub-lifecycle"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: space.sm,
            marginTop: space.lg,
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: radius.pill,
            padding: `${space.sm} ${space.md}`,
            width: "fit-content",
          }}
        >
          {LIFECYCLE.map((s, i) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: space.sm }}>
              {i > 0 && <span style={{ color: "rgba(255,255,255,0.7)" }} aria-hidden>→</span>}
              <span style={{ background: "#fff", borderRadius: radius.pill, display: "inline-flex" }}>
                <StateBadge status={s} />
              </span>
            </span>
          ))}
        </div>
        <p style={{ margin: `${space.lg} 0 0`, color: "rgba(255,255,255,0.82)", fontSize: font.size.sm, maxWidth: "62ch" }}>
          Una <strong>cassetta degli attrezzi, non una procedura guidata</strong>: apri gli
          strumenti nell&apos;ordine che vuoi. Il contrappeso è il misuratore di autenticità —
          l&apos;AI porta il mestiere, tu l&apos;esperienza vissuta e il giudizio finale.
        </p>
      </section>

      {GROUP_ORDER.map((g) => {
        const items = SURFACES.filter((s) => s.group === g);
        if (items.length === 0) return null;
        return (
          <section key={g} style={{ marginBottom: space.xl }}>
            <SectionTitle>{GROUP_LABEL[g]}</SectionTitle>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: space.md,
              }}
            >
              {items.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  data-testid={`tile-${s.navTestId}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <Card interactive style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <span
                      aria-hidden
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: radius.md,
                        display: "grid",
                        placeItems: "center",
                        fontSize: "1.35rem",
                        background: `${s.accent}14`,
                        border: `1px solid ${s.accent}3d`,
                        marginBottom: space.md,
                      }}
                    >
                      {s.icon}
                    </span>
                    <strong style={{ display: "block", marginBottom: space.xs, color: color.text }}>
                      {s.label}
                    </strong>
                    <span style={{ display: "block", color: color.textMuted, fontSize: font.size.sm, flex: 1 }}>
                      {s.hint}
                    </span>
                    <span style={{ display: "block", marginTop: space.md, color: s.accent, fontWeight: font.weight.semibold }}>
                      Apri →
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
