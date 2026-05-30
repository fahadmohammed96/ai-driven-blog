import type { Theme } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import type { EmailPort } from "./email.port";
import { renderNewsletter } from "./render";
import { confirmedSegmentForTheme } from "./subscribers.repo";

/** The segment for a theme: emails of confirmed subscribers opted into it. */
export function segmentForTheme(db: Db, tenantId: string, theme: Theme): Promise<string[]> {
  return withTenant(db, tenantId, (tx) =>
    confirmedSegmentForTheme(tx, theme).then((rows) => rows.map((r) => r.email)),
  );
}

export interface SendNewsletterInput {
  tenantId: string;
  theme: Theme;
  subject: string;
  html: string;
  /** Base URL of the unsubscribe endpoint; the per-subscriber token is appended. */
  unsubscribeBaseUrl: string;
}

/**
 * Send a newsletter to a theme's segment: only confirmed subscribers opted into
 * that theme receive it (pending/unsubscribed and other themes are excluded).
 * Returns the recipients actually sent to.
 */
export async function sendNewsletterToSegment(
  deps: { db: Db; email: EmailPort },
  input: SendNewsletterInput,
): Promise<{ recipients: string[] }> {
  const segment = await withTenant(deps.db, input.tenantId, (tx) =>
    confirmedSegmentForTheme(tx, input.theme),
  );
  for (const member of segment) {
    await deps.email.send(
      renderNewsletter({
        to: member.email,
        subject: input.subject,
        html: input.html,
        unsubscribeUrl: `${input.unsubscribeBaseUrl}?token=${member.token}`,
      }),
    );
  }
  return { recipients: segment.map((m) => m.email) };
}
