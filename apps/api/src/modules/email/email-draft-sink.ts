import type { EmailDraft } from "@blogs/contracts";
import type { EmailDraftSink } from "../content";
import type { Db } from "../../platform/db/client";
import type { EmailPort } from "./email.port";
import { sendNewsletterToSegment } from "./newsletter";

/**
 * The `email_draft` gate sink (Slice S3), wired by the email module and INJECTED
 * into the `AgentProposalStore` (`modules/content`) so content never imports
 * email (no barrel cycle, DEBT-031c). On approval it composes the draft into HTML
 * and reuses the EXISTING `sendNewsletterToSegment` — the SAME segmented send the
 * `POST /newsletter/send` human action uses — so only confirmed opt-in
 * subscribers of the draft's theme receive it. Nothing is sent before approval.
 */

/** Compose the draft's HTML body + CTA (the preheader is a hidden preview snippet). */
function composeHtml(draft: EmailDraft): string {
  const preview = `<span style="display:none">${draft.preheader}</span>`;
  const cta = `<p><a href="${draft.ctaUrl}">${draft.ctaText}</a></p>`;
  return `${preview}\n${draft.body}\n${cta}`;
}

export function makeEmailDraftSink(deps: {
  db: Db;
  email: EmailPort;
  unsubscribeBaseUrl: string;
}): EmailDraftSink {
  return {
    send: (tenantId, draft) =>
      sendNewsletterToSegment(
        { db: deps.db, email: deps.email },
        {
          tenantId,
          theme: draft.theme,
          subject: draft.subject,
          html: composeHtml(draft),
          unsubscribeBaseUrl: deps.unsubscribeBaseUrl,
        },
      ),
  };
}
