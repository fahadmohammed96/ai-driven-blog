import Link from "next/link";
import { PageHeader } from "../../../src/ui/components";
import { color, radius, shadow, space } from "../../../src/ui/tokens";
import { SURFACES } from "../surfaces";

/**
 * Hub home: the entry to the toolbox. Presents the 4 surfaces as independent
 * tools (not steps) — "l'AI propone, l'umano conferma". Real dashboards/metrics
 * are out of scope for slice 0; this is the landing + launcher.
 */
export default function HubHome() {
  return (
    <div data-testid="surface-hub">
      <PageHeader
        title="Content Hub"
        subtitle="La tua redazione AI: scegli uno strumento. Gli specialisti propongono, tu confermi."
      />
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
            <span style={{ color: color.textMuted }}>{s.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
