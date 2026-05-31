/**
 * The content-hub toolbox: the 4 surfaces + the hub entry, modelled as
 * INDEPENDENT sections (ADR-0020: "toolbox, not wizard"). Order here is display
 * order in the nav rail, NOT a required sequence — the user picks any surface in
 * any order. Slices fill in the real functionality one surface at a time.
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
  /** Slice that delivers the real surface (0 = the shell itself). */
  slice: number;
}

export const HUB_HOME: Surface = {
  href: "/hub",
  label: "Hub",
  navTestId: "nav-hub",
  hint: "Panoramica e accesso ai tuoi strumenti.",
  slice: 0,
};

export const SURFACES: Surface[] = [
  {
    href: "/library",
    label: "Library",
    navTestId: "nav-library",
    hint: "Tutti i contenuti, filtrabili, con il loro stato di pubblicazione.",
    slice: 1,
  },
  {
    href: "/editor",
    label: "Block Editor",
    navTestId: "nav-editor",
    hint: "Modifica un contenuto sul modello a blocchi canonico + misuratore di autenticità.",
    slice: 2,
  },
  {
    href: "/proposals",
    label: "Proposal Queue",
    navTestId: "nav-proposals",
    hint: "Le proposte degli specialisti AI: approva, modifica o rifiuta.",
    slice: 3,
  },
  {
    href: "/settings",
    label: "Settings",
    navTestId: "nav-settings",
    hint: "Brand voice, autonomia per specialista, canali.",
    slice: 4,
  },
];
