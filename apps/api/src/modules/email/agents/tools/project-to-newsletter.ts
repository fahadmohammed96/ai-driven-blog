import type { Block, EmailDraft, Theme } from "@blogs/contracts";
import { emailDraftSchema } from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `projectToNewsletter` — the DETERMINISTIC article → newsletter projector
 * (agentic-plan §4, Slice S3), wrapped as a `side: 'draft'` tool. It shapes an
 * {@link EmailDraft} but persists/sends NOTHING (the human gate sends on
 * approval). The article + theme are bound at construction so the tool input is
 * empty; the projection is a pure function of the article (subject = title,
 * body = blocks → HTML, preheader/cta deterministic), mirroring the social
 * channel projectors. The LLM layer (path B) only refines subject/preheader; the
 * body is always this deterministic projection.
 */

export const PROJECT_TO_NEWSLETTER_TOOL_ID = "projectToNewsletter";

const PREHEADER_MAX = 200;
const SUBJECT_MAX = 200;
const CTA_TEXT = "Leggi l'articolo";

/** The source an article is projected into a newsletter from (canonical blocks). */
export interface NewsletterSource {
  contentItemId: string;
  title: string;
  blocks: Block[];
  /** Canonical published URL — the CTA target. */
  link?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text paragraphs of the article (for the preheader + brand-voice scoring). */
export function articleParagraphs(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Extract<Block, { type: "paragraph" }> => b.type === "paragraph")
    .map((b) => b.text.trim())
    .filter(Boolean);
}

/** Render the canonical blocks into a simple newsletter HTML body (headings + paragraphs). */
export function blocksToHtml(blocks: Block[], title: string): string {
  const parts: string[] = [`<h1>${escapeHtml(title)}</h1>`];
  for (const block of blocks) {
    if (block.type === "heading") {
      const level = Math.min(Math.max(block.level, 2), 3); // h1 is the title
      parts.push(`<h${level}>${escapeHtml(block.text)}</h${level}>`);
    } else if (block.type === "paragraph" && block.text.trim()) {
      parts.push(`<p>${escapeHtml(block.text.trim())}</p>`);
    }
  }
  return parts.join("\n");
}

/** Truncate to `limit` chars on a word boundary, never producing an empty string. */
function truncate(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  const slice = t.slice(0, limit);
  const cut = slice.lastIndexOf(" ");
  return (cut > 0 ? slice.slice(0, cut) : slice).trimEnd();
}

/**
 * Project a canonical article into a newsletter draft for a theme's segment.
 * Pure and deterministic — same article + theme → same draft (so a same-day
 * replay reproduces the exact payload and the audit row dedupes).
 */
export function projectToNewsletter(source: NewsletterSource, theme: Theme): EmailDraft {
  const paragraphs = articleParagraphs(source.blocks);
  const lead = paragraphs[0] ?? source.title;
  const draft: EmailDraft = {
    contentItemId: source.contentItemId,
    theme,
    subject: truncate(source.title || "Newsletter", SUBJECT_MAX),
    preheader: truncate(lead, PREHEADER_MAX),
    body: blocksToHtml(source.blocks, source.title) || `<p>${escapeHtml(lead)}</p>`,
    ctaText: CTA_TEXT,
    ctaUrl: source.link?.trim() || "#",
  };
  return emailDraftSchema.parse(draft);
}

function isOutput(v: unknown): v is { draft: EmailDraft } {
  return isObject(v) && emailDraftSchema.safeParse(v.draft).success;
}

export function createProjectToNewsletterTool(
  source: NewsletterSource,
  theme: Theme,
): ToolDefinition<Record<string, never>, { draft: EmailDraft }> {
  return {
    id: PROJECT_TO_NEWSLETTER_TOOL_ID,
    description:
      "Proietta l'articolo nella bozza newsletter per il segmento del tema (proiettore deterministico, nessun invio).",
    inputSchema: schema("projectToNewsletter input", (v): v is Record<string, never> => isObject(v)),
    outputSchema: schema("projectToNewsletter output", isOutput),
    tenantScoped: false,
    side: "draft",
    maxOutputTokens: 2_000,
    stubArgs: () => ({}),
    execute: async () => ({ draft: projectToNewsletter(source, theme) }),
  };
}
