/**
 * The content-hub toolbox: the 4 surfaces + the hub entry, modelled as
 * INDEPENDENT sections (ADR-0020/0021: "toolbox, not wizard"). Order here is
 * display order in the nav rail, NOT a required sequence — the user picks any
 * surface in any order. All four surfaces are now built (slices 1–4).
 */
export interface Surface {
  /** Route segment under the (hub) group. */
  href: string;
  /** Label in the toolbox rail. */
  label: string;
  /** data-testid of the nav link (asserted by the e2e smoke). */
  navTestId: string;
  /** One-line "what this tool does" hint. */
  hint: string;
}

export const HUB_HOME: Surface = {
  href: "/hub",
  label: "Hub",
  navTestId: "nav-hub",
  hint: "Panoramica e accesso ai tuoi strumenti.",
};

export const SURFACES: Surface[] = [
  {
    href: "/library",
    label: "Library",
    navTestId: "nav-library",
    hint: "Tutti i contenuti, filtrabili, con il loro stato di pubblicazione.",
  },
  {
    href: "/editor",
    label: "Block Editor",
    navTestId: "nav-editor",
    hint: "Modifica un contenuto sul modello a blocchi canonico + misuratore di autenticità.",
  },
  {
    href: "/proposals",
    label: "Proposal Queue",
    navTestId: "nav-proposals",
    hint: "Le proposte degli specialisti AI: approva, modifica o rifiuta.",
  },
  {
    href: "/settings",
    label: "Settings",
    navTestId: "nav-settings",
    hint: "Brand voice, autonomia per specialista, canali.",
  },
];
