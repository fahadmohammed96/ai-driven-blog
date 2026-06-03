/**
 * The content-hub toolbox: the surfaces + the hub entry, modelled as
 * INDEPENDENT sections (ADR-0020/0021: "toolbox, not wizard"). Order here is
 * display order in the nav rail, NOT a required sequence — the user picks any
 * surface in any order.
 *
 * `icon` (emoji) + `accent` give each tool a glanceable identity in the rail
 * and on the hub tiles; `group` clusters the rail into labelled sections.
 */
export type SurfaceGroup = "create" | "grow" | "operate";

export interface Surface {
  /** Route segment under the (hub) group. */
  href: string;
  /** Label in the toolbox rail. */
  label: string;
  /** data-testid of the nav link (asserted by the e2e smoke). */
  navTestId: string;
  /** One-line "what this tool does" hint. */
  hint: string;
  /** Glanceable emoji icon. */
  icon: string;
  /** Accent color (hex) used for the icon chip + hub tile stripe. */
  accent: string;
  /** Which rail section this tool belongs to. */
  group: SurfaceGroup;
}

export const GROUP_LABEL: Record<SurfaceGroup, string> = {
  create: "Crea",
  grow: "Cresci",
  operate: "Gestisci",
};

export const HUB_HOME: Surface = {
  href: "/hub",
  label: "Hub",
  navTestId: "nav-hub",
  hint: "Panoramica e accesso ai tuoi strumenti.",
  icon: "🏠",
  accent: "#4f46e5",
  group: "create",
};

export const SURFACES: Surface[] = [
  {
    href: "/library",
    label: "Library",
    navTestId: "nav-library",
    hint: "Tutti i contenuti, filtrabili, con il loro stato di pubblicazione.",
    icon: "📚",
    accent: "#2563eb",
    group: "create",
  },
  {
    href: "/editor",
    label: "Block Editor",
    navTestId: "nav-editor",
    hint: "Modifica un contenuto sul modello a blocchi canonico + misuratore di autenticità.",
    icon: "✍️",
    accent: "#7c3aed",
    group: "create",
  },
  {
    href: "/proposals",
    label: "Proposal Queue",
    navTestId: "nav-proposals",
    hint: "Le proposte degli specialisti AI: approva, modifica o rifiuta.",
    icon: "🧠",
    accent: "#d97706",
    group: "create",
  },
  {
    href: "/affiliates",
    label: "Affiliates",
    navTestId: "nav-affiliates",
    hint: "Link di affiliazione tracciati: /go/:code conta i click per link, articolo e canale.",
    icon: "🔗",
    accent: "#0891b2",
    group: "grow",
  },
  {
    href: "/trips",
    label: "Trips",
    navTestId: "nav-trips",
    hint: "Viaggi programmati: lancia partenze, prenota un posto, versa l'acconto (waitlist se pieno).",
    icon: "🧭",
    accent: "#16a34a",
    group: "grow",
  },
  {
    href: "/crm",
    label: "CRM",
    navTestId: "nav-crm",
    hint: "Richieste su misura: l'AI propone, tu approvi prima dell'invio, acconto e consegna nel portale cliente.",
    icon: "🤝",
    accent: "#db2777",
    group: "grow",
  },
  {
    href: "/analytics",
    label: "Analytics",
    navTestId: "nav-analytics",
    hint: "Dashboard unificata cross-canale: affiliazioni/newsletter/social/contenuti (reali) + GA4 e Search Console (stub).",
    icon: "📊",
    accent: "#0d9488",
    group: "operate",
  },
  {
    href: "/settings",
    label: "Settings",
    navTestId: "nav-settings",
    hint: "Brand voice, autonomia per specialista, canali.",
    icon: "⚙️",
    accent: "#64748b",
    group: "operate",
  },
];
