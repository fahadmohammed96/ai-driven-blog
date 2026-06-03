/**
 * Design tokens for the content-hub UI.
 *
 * Surfaces style with inline `style={{}}` objects + the small set of primitives
 * in `./components` — there is no Tailwind/CSS-modules/component library, and we
 * keep it that way. This file is the single source of truth for color, spacing,
 * typography and elevation so every surface stays visually consistent.
 *
 * Redesign note: the palette moved from a flat single-accent wireframe to a
 * professional, lightly-colorful SaaS system (indigo primary + a semantic status
 * palette + a real elevation scale). ALL previously-exported names and keys are
 * preserved for backward compatibility; new tokens are additive.
 */

export const color = {
  // ── Surfaces ────────────────────────────────────────────────────────────
  bg: "#f5f6fb", // app canvas (a touch cool); the body adds a subtle gradient
  surface: "#ffffff",
  surfaceMuted: "#f3f4f8",
  surfaceSunken: "#eceef5",
  border: "#e4e7f0",
  borderStrong: "#d3d8e6",

  // ── Text ────────────────────────────────────────────────────────────────
  text: "#171a23", // near-black slate, high contrast
  textMuted: "#646b80",
  textFaint: "#8b91a4",
  textOnAccent: "#ffffff",

  // ── Brand / accent — "l'AI propone, l'umano conferma" ─────────────────────
  accent: "#4f46e5", // indigo-600
  accentHover: "#4338ca", // indigo-700
  accentSoft: "#ecebff",
  accentBorder: "#c9c5ff",
  accentText: "#4338ca",

  // ── Publication-state palette (maps to PublicationStatus) ─────────────────
  draft: "#64748b", // slate
  proposed: "#2563eb", // blue
  review: "#d97706", // amber
  approved: "#16a34a", // green
  published: "#0891b2", // teal
  danger: "#dc2626",
  dangerHover: "#b91c1c",
  success: "#16a34a",
  warning: "#d97706",
  info: "#2563eb",
} as const;

/** Brand & accent gradients (hero, logo mark, primary CTA sheen). */
export const gradient = {
  brand: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #a855f7 100%)",
  brandSoft: "linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)",
  accent: "linear-gradient(135deg, #4f46e5 0%, #6d28d9 100%)",
  app: "linear-gradient(180deg, #f7f8fd 0%, #f2f3fa 100%)",
} as const;

export const space = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
} as const;

export const radius = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "22px",
  pill: "999px",
} as const;

export const font = {
  // Inter is loaded via a <link> in the root layout; system stack is the
  // graceful fallback so an offline build/CI never breaks on a missing webfont.
  family:
    "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  size: {
    xs: "0.75rem",
    sm: "0.85rem",
    md: "0.975rem",
    lg: "1.2rem",
    xl: "1.7rem",
    "2xl": "2.2rem",
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.55,
  },
} as const;

export const shadow = {
  xs: "0 1px 2px rgba(20, 24, 48, 0.05)",
  card: "0 1px 2px rgba(20, 24, 48, 0.05), 0 6px 18px rgba(20, 24, 48, 0.05)",
  cardHover: "0 2px 6px rgba(20, 24, 48, 0.07), 0 14px 34px rgba(20, 24, 48, 0.10)",
  lg: "0 12px 40px rgba(20, 24, 48, 0.14)",
  ring: "0 0 0 3px rgba(79, 70, 229, 0.22)",
} as const;

/** Width of the persistent toolbox rail in the hub shell. */
export const NAV_WIDTH = "256px";
