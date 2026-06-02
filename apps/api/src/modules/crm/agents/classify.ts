import type {
  InboundClassification,
  InboundIntent,
  LeadQualification,
} from "@blogs/contracts";

/**
 * Deterministic inbound triage (Slice O2) — a pure, keyword/pattern heuristic
 * that classifies a raw inbound message and derives the seed reply, lead
 * qualification and suggested next action. Kept PURE and SHARED so both the agent
 * (the deterministic seed) and the `classifyInbound` tool produce the SAME
 * `classification` — and so it stays STABLE in CI (no LLM, zero cost).
 *
 * TODO(debt): DEBT-039 — this is a heuristic, not the real Haiku classifier;
 * trigger = the first real inbound signal in production.
 */

/** Complaint markers take precedence: an angry customer is never "just a lead". */
const RECLAMO_MARKERS = [
  "reclamo",
  "rimbors",
  "pessim",
  "delus",
  "lament",
  "arrabbiat",
  "insoddisfatt",
  "vergogn",
  "scandal",
  "ritardo",
  "non funziona",
  "truffa",
];

/** Buying-intent markers → a sales opportunity (a lead). */
const LEAD_MARKERS = [
  "preventivo",
  "prenot",
  "vorrei",
  "viaggio",
  "quanto cost",
  "disponibil",
  "interessat",
  "organizz",
  "partir",
  "vacanz",
  "itinerari",
  "offerta",
];

/** Strong buying markers escalate a lead's intent from `warm` to `hot`. */
const HOT_MARKERS = ["preventivo", "prenot", "quanto cost", "disponibil"];

function matches(haystack: string, markers: string[]): boolean {
  return markers.some((m) => haystack.includes(m));
}

/**
 * Classify a raw inbound message. DETERMINISTIC: complaint > lead > info, so a
 * dissatisfied customer who also mentions a trip is still routed as `reclamo`.
 */
export function classifyInbound(message: string): InboundClassification {
  const text = message.toLowerCase();
  if (matches(text, RECLAMO_MARKERS)) return "reclamo";
  if (matches(text, LEAD_MARKERS)) return "lead";
  return "info";
}

/** A lead's coarse intent from the buying-signal strength (deterministic). */
export function deriveIntent(message: string): InboundIntent {
  return matches(message.toLowerCase(), HOT_MARKERS) ? "hot" : "warm";
}

/**
 * Qualify a lead from the signal, when it is one (classification `lead`) or when
 * it is tied to an existing pipeline lead. Returns `undefined` otherwise (an
 * `info`/`reclamo` signal with no lead anchor is not a sales opportunity).
 */
export function qualifyLead(
  classification: InboundClassification,
  message: string,
  leadId: string | undefined,
): LeadQualification | undefined {
  if (classification !== "lead" && leadId === undefined) return undefined;
  const summary = message.trim().slice(0, 280) || "(richiesta senza testo)";
  return {
    intent: classification === "lead" ? deriveIntent(message) : "cold",
    summary,
    ...(leadId !== undefined ? { leadId } : {}),
  };
}

/** The deterministic next action the founder should take, per classification. */
export function suggestNextAction(classification: InboundClassification): string {
  switch (classification) {
    case "lead":
      return "Apri un lead nella pipeline CRM (createLead) e prepara una proposta su misura prima di rispondere.";
    case "reclamo":
      return "Gestisci il reclamo di persona: rispondi con tono empatico e valuta un rimborso o un recupero.";
    case "info":
      return "Rispondi con le informazioni richieste; nessuna azione di vendita necessaria.";
  }
}

/**
 * A courteous seed reply in the tenant's tone, per classification. The LLM step
 * may refine the wording, but this is always a valid, on-brand fallback (so even
 * the offline prose stub yields a complete, sendable-by-a-human draft).
 */
export function buildSeedReply(
  classification: InboundClassification,
  tone: string,
): string {
  const opener = tone.trim() ? `Con tono ${tone.trim()}: ` : "";
  switch (classification) {
    case "lead":
      return `${opener}Grazie per averci scritto! Saremo felici di aiutarti a organizzare il tuo viaggio. Per prepararti una proposta su misura ci servono ancora un paio di dettagli (date, durata, preferenze).`;
    case "reclamo":
      return `${opener}Ci dispiace molto per il disagio: prendiamo la tua segnalazione molto sul serio. Vogliamo capire cosa è successo e trovare insieme una soluzione il prima possibile.`;
    case "info":
      return `${opener}Grazie per il tuo messaggio! Ecco le informazioni che ci hai chiesto; resta a disposizione per qualsiasi altra domanda.`;
  }
}
