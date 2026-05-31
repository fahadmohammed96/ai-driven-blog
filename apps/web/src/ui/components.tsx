import type { CSSProperties, ReactNode } from "react";
import { color, font, radius, shadow, space } from "./tokens";

/**
 * Mirrors `PublicationStatus` from `@blogs/contracts` (the publish state
 * machine). `apps/web` doesn't depend on the contracts package — the legacy
 * surfaces inline their types too — so we restate the union here. If a slice
 * later wires the FE to contracts, swap this for the imported type.
 */
export type PublicationStatus = "draft" | "proposed" | "review" | "approved" | "published";

/**
 * Base UI primitives for the content-hub (slice 0 baseline).
 *
 * Plain presentational components built on inline styles + design tokens — the
 * same convention `/studio` and `/newsletter` already use, no new framework.
 * They are server-safe (no hooks), so both server and client surfaces can use
 * them. Later slices compose these instead of re-rolling inline styles.
 */

/** A page section heading with an optional supporting line. */
export function PageHeader({
  title,
  subtitle,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  testId?: string;
}) {
  return (
    <header data-testid={testId} style={{ marginBottom: space.lg }}>
      <h1 style={{ fontSize: font.size.xl, margin: 0, color: color.text }}>{title}</h1>
      {subtitle && (
        <p style={{ color: color.textMuted, margin: `${space.xs} 0 0`, fontSize: font.size.md }}>
          {subtitle}
        </p>
      )}
    </header>
  );
}

/** A raised content container. */
export function Card({
  children,
  style,
  testId,
}: {
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        boxShadow: shadow.card,
        padding: space.lg,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const STATE_COLOR: Record<PublicationStatus, string> = {
  draft: color.draft,
  proposed: color.proposed,
  review: color.review,
  approved: color.approved,
  published: color.published,
};

/**
 * State badge for the publish state machine (draft→proposed→review→approved→
 * published). The Library + Proposal Queue slices reuse this so the universal
 * propose→approve gesture reads the same everywhere.
 */
export function StateBadge({ status }: { status: PublicationStatus }) {
  const c = STATE_COLOR[status];
  return (
    <span
      data-testid={`state-badge-${status}`}
      style={{
        display: "inline-block",
        fontSize: font.size.sm,
        fontWeight: 600,
        color: c,
        background: `${c}1a`, // ~10% alpha
        border: `1px solid ${c}55`,
        borderRadius: radius.sm,
        padding: `2px ${space.sm}`,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

/**
 * Placeholder used by every slice-0 surface stub. It states which later slice
 * delivers the real feature — the E2E smoke asserts this "coming in slice N"
 * contract, and later slices replace the placeholder.
 */
export function SurfacePlaceholder({ slice, children }: { slice: number; children: ReactNode }) {
  return (
    <Card testId="surface-placeholder" style={{ borderStyle: "dashed", background: color.surfaceMuted }}>
      <p style={{ margin: 0, color: color.textMuted }}>{children}</p>
      <p style={{ margin: `${space.sm} 0 0`, color: color.accent, fontWeight: 600 }}>
        Coming in slice {slice}.
      </p>
    </Card>
  );
}
