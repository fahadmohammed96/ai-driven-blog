import type { Theme } from "@blogs/contracts";
import type { EmailMessage } from "./email.port";

const DEFAULT_FROM = "Blogs Manager <no-reply@blogs.local>";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Double opt-in confirmation email: the tokenized link is the proof of consent. */
export function renderConfirmEmail(opts: {
  to: string;
  confirmUrl: string;
  themes: Theme[];
  from?: string;
}): EmailMessage {
  const themes = opts.themes.join(", ");
  return {
    to: opts.to,
    from: opts.from ?? DEFAULT_FROM,
    subject: "Conferma la tua iscrizione",
    text: `Conferma l'iscrizione ai temi: ${themes}.\nClicca: ${opts.confirmUrl}\nSe non sei stato tu, ignora questa email.`,
    html: `<p>Conferma l'iscrizione ai temi: <strong>${escapeHtml(themes)}</strong>.</p>
<p><a href="${escapeHtml(opts.confirmUrl)}">Conferma l'iscrizione</a></p>
<p>Se non sei stato tu, ignora questa email.</p>`,
  };
}

/** A newsletter to a confirmed subscriber, with a mandatory unsubscribe link (GDPR). */
export function renderNewsletter(opts: {
  to: string;
  subject: string;
  html: string;
  unsubscribeUrl: string;
  from?: string;
}): EmailMessage {
  return {
    to: opts.to,
    from: opts.from ?? DEFAULT_FROM,
    subject: opts.subject,
    text: `${opts.html.replace(/<[^>]+>/g, "")}\n\nAnnulla l'iscrizione: ${opts.unsubscribeUrl}`,
    html: `${opts.html}
<hr/>
<p><a href="${escapeHtml(opts.unsubscribeUrl)}">Annulla l'iscrizione</a></p>`,
  };
}
