/**
 * Design tokens for the content-hub UI (slice 0 baseline).
 *
 * The existing surfaces (`/studio`, `/newsletter`) style with inline `style={{}}`
 * objects and the system font stack — there is no Tailwind, CSS-modules or
 * component library in this app. We keep that convention and DO NOT introduce a
 * new UI framework: tokens are plain TS values consumed by inline styles and the
 * small set of primitives in `./components`. This is the single source of truth
 * for spacing/color/typography so later slices stay visually consistent.
 */

export const color = {
  // Surfaces
  bg: "#f7f7f8",
  surface: "#ffffff",
  surfaceMuted: "#f1f1f3",
  border: "#e3e3e7",
  // Text
  text: "#18181b",
  textMuted: "#6b6b76",
  // Brand / accent — "l'AI propone, l'umano conferma"
  accent: "#3b5bdb",
  accentSoft: "#e7ecff",
  // Publication-state palette (maps to PublicationStatus from @blogs/contracts)
  draft: "#6b6b76",
  proposed: "#1c7ed6",
  review: "#f08c00",
  approved: "#2f9e44",
  published: "#0b7285",
  danger: "#e03131",
} as const;

export const space = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
} as const;

export const font = {
  family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  size: {
    sm: "0.85rem",
    md: "1rem",
    lg: "1.25rem",
    xl: "1.75rem",
  },
} as const;

export const shadow = {
  card: "0 1px 2px rgba(16,16,20,0.06), 0 1px 8px rgba(16,16,20,0.04)",
} as const;

/** Width of the persistent toolbox rail in the hub shell. */
export const NAV_WIDTH = "232px";
