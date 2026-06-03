import type { CSSProperties, ReactNode } from "react";
import { color, font, gradient, radius, shadow, space } from "./tokens";

/**
 * Mirrors `PublicationStatus` from `@blogs/contracts` (the publish state
 * machine). `apps/web` doesn't depend on the contracts package — the legacy
 * surfaces inline their types too — so we restate the union here.
 */
export type PublicationStatus = "draft" | "proposed" | "review" | "approved" | "published";

/**
 * Base UI primitives for the content-hub.
 *
 * Plain presentational components built on inline styles + design tokens — the
 * same convention the surfaces use, no new framework. They are server-safe (no
 * hooks), so both server and client surfaces can use them. The redesign keeps
 * every prior signature intact and adds a few primitives (Button, StatCard,
 * Toolbar, EmptyState, SectionTitle) so surfaces stop re-rolling inline styles.
 */

/** A page section heading with an optional eyebrow + supporting line. */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  testId?: string;
}) {
  return (
    <header data-testid={testId} style={{ marginBottom: space.xl }}>
      {eyebrow && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: space.xs,
            color: color.accentText,
            background: color.accentSoft,
            border: `1px solid ${color.accentBorder}`,
            borderRadius: radius.pill,
            padding: `3px ${space.sm}`,
            fontSize: font.size.xs,
            fontWeight: font.weight.semibold,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: space.sm,
          }}
        >
          {eyebrow}
        </div>
      )}
      <h1
        style={{
          fontSize: font.size.xl,
          fontWeight: font.weight.bold,
          margin: 0,
          color: color.text,
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          style={{
            color: color.textMuted,
            margin: `${space.sm} 0 0`,
            fontSize: font.size.md,
            maxWidth: "68ch",
            lineHeight: font.lineHeight.normal,
          }}
        >
          {subtitle}
        </p>
      )}
    </header>
  );
}

/** A raised content container. Pass `interactive` for a hover-lift (links/tiles). */
export function Card({
  children,
  style,
  interactive,
  testId,
}: {
  children: ReactNode;
  style?: CSSProperties;
  interactive?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={interactive ? "bm-card bm-card--interactive" : "bm-card"}
      style={{
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
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
 * published). A soft pill with a status-colored dot — the universal
 * propose→approve gesture reads the same everywhere it appears.
 */
export function StateBadge({ status }: { status: PublicationStatus }) {
  const c = STATE_COLOR[status];
  return (
    <span
      data-testid={`state-badge-${status}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: font.size.xs,
        fontWeight: font.weight.semibold,
        color: c,
        background: `${c}14`, // ~8% alpha
        border: `1px solid ${c}3d`,
        borderRadius: radius.pill,
        padding: `3px 10px`,
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }}
      />
      {status}
    </span>
  );
}

type ButtonVariant = "primary" | "danger" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

const VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: { background: color.accent, color: color.textOnAccent, border: "1px solid transparent" },
  danger: { background: color.danger, color: color.textOnAccent, border: "1px solid transparent" },
  secondary: { background: color.surface, color: color.text, border: `1px solid ${color.borderStrong}` },
  ghost: { background: "transparent", color: color.accentText, border: "1px solid transparent" },
};

/** Primary/secondary/danger/ghost button. Disabled state dims + drops the cursor. */
export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled,
  onClick,
  type = "button",
  testId,
  style,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  testId?: string;
  style?: CSSProperties;
}) {
  const pad = size === "sm" ? `${space.xs} ${space.md}` : `${space.sm} ${space.lg}`;
  return (
    <button
      type={type}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...VARIANT_STYLE[variant],
        fontSize: size === "sm" ? font.size.sm : font.size.md,
        fontWeight: font.weight.semibold,
        padding: pad,
        borderRadius: radius.md,
        boxShadow: variant === "primary" || variant === "danger" ? shadow.xs : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/**
 * A compact metric tile: big number + label, with an optional accent stripe and
 * trailing slot. Replaces the "infinite table" feel with scannable headline KPIs.
 */
export function StatCard({
  label,
  value,
  hint,
  accent = color.accent,
  trailing,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
  trailing?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="bm-card"
      style={{
        position: "relative",
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: `${space.md} ${space.lg}`,
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accent }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm }}>
        <span
          style={{
            fontSize: font.size.xs,
            fontWeight: font.weight.semibold,
            color: color.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
        {trailing}
      </div>
      <div style={{ fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.text, marginTop: space.xs }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: font.size.sm, color: color.textFaint, marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

/** A horizontal control bar (filters + actions) sitting above a list. */
export function Toolbar({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: space.md,
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        boxShadow: shadow.xs,
        padding: `${space.sm} ${space.md}`,
        marginBottom: space.lg,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Friendly empty state: an icon, a line, and (optionally) a hint/action. */
export function EmptyState({
  icon = "✨",
  title,
  children,
  testId,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Card testId={testId} style={{ textAlign: "center", padding: space.xl, background: gradient.brandSoft }}>
      <div style={{ fontSize: "2rem", lineHeight: 1 }} aria-hidden>
        {icon}
      </div>
      <p style={{ margin: `${space.md} 0 0`, color: color.text, fontWeight: font.weight.semibold }}>{title}</p>
      {children && (
        <p style={{ margin: `${space.xs} 0 0`, color: color.textMuted, fontSize: font.size.sm }}>{children}</p>
      )}
    </Card>
  );
}

/** A lightweight section title with an optional trailing slot. */
export function SectionTitle({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        margin: `0 0 ${space.md}`,
      }}
    >
      <h2 style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, margin: 0, color: color.text }}>
        {children}
      </h2>
      {trailing}
    </div>
  );
}

/**
 * Placeholder used by surface stubs. States which later slice delivers the real
 * feature — the E2E smoke asserts this "coming in slice N" contract.
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
