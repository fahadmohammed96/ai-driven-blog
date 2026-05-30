import { randomUUID } from "node:crypto";
import type { SubscriberStatus, Theme } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import type { EmailPort } from "./email.port";
import { renderConfirmEmail } from "./render";
import { nextSubscriberStatus } from "./optin-state";
import {
  findSubscriberByEmail,
  findSubscriberByToken,
  insertSubscriber,
  resetToPending,
  setSubscriberStatus,
  addThemes,
} from "./subscribers.repo";

export class InvalidConfirmTokenError extends Error {
  constructor() {
    super("invalid or unknown confirmation token");
    this.name = "InvalidConfirmTokenError";
  }
}

export interface SubscribeResult {
  status: SubscriberStatus;
  /** True when the email was already confirmed (no confirmation re-sent). */
  alreadyConfirmed: boolean;
}

export interface SubscribeInput {
  tenantId: string;
  email: string;
  themes: Theme[];
  /** Base URL of the confirm endpoint; the token is appended as ?token=. */
  confirmBaseUrl: string;
}

/**
 * Double opt-in step 1: record the consent request (pending + token + themes)
 * and send the confirmation email. Idempotent for an already-confirmed address
 * (adds any new themes, sends nothing). The email is sent only after the DB
 * transaction commits.
 */
export async function subscribe(
  deps: { db: Db; email: EmailPort },
  input: SubscribeInput,
): Promise<SubscribeResult> {
  const token = randomUUID();
  const plan = await withTenant(deps.db, input.tenantId, async (tx) => {
    const existing = await findSubscriberByEmail(tx, input.email);
    if (existing && existing.status === "confirmed") {
      await addThemes(tx, { tenantId: input.tenantId, subscriberId: existing.id, themes: input.themes });
      return { send: false as const };
    }
    // New, or pending/unsubscribed → (re-)arm a pending double opt-in with a fresh token.
    const sub = existing
      ? await resetToPending(tx, existing.id, token)
      : await insertSubscriber(tx, { tenantId: input.tenantId, email: input.email, token });
    await addThemes(tx, { tenantId: input.tenantId, subscriberId: sub.id, themes: input.themes });
    return { send: true as const, token: sub.confirmToken };
  });

  if (!plan.send) return { status: "confirmed", alreadyConfirmed: true };

  const confirmUrl = `${input.confirmBaseUrl}?token=${plan.token}`;
  await deps.email.send(renderConfirmEmail({ to: input.email, confirmUrl, themes: input.themes }));
  return { status: "pending", alreadyConfirmed: false };
}

/** Double opt-in step 2: confirm via the tokenized link (idempotent). */
export async function confirm(
  deps: { db: Db },
  input: { tenantId: string; token: string },
): Promise<{ email: string; status: SubscriberStatus }> {
  return withTenant(deps.db, input.tenantId, async (tx) => {
    const sub = await findSubscriberByToken(tx, input.token);
    if (!sub) throw new InvalidConfirmTokenError();
    const to = nextSubscriberStatus(sub.status as SubscriberStatus, "confirm");
    const row = await setSubscriberStatus(tx, sub.id, to);
    return { email: row.email, status: row.status as SubscriberStatus };
  });
}

/** Unsubscribe via the tokenized link. */
export async function unsubscribe(
  deps: { db: Db },
  input: { tenantId: string; token: string },
): Promise<{ email: string; status: SubscriberStatus }> {
  return withTenant(deps.db, input.tenantId, async (tx) => {
    const sub = await findSubscriberByToken(tx, input.token);
    if (!sub) throw new InvalidConfirmTokenError();
    const to = nextSubscriberStatus(sub.status as SubscriberStatus, "unsubscribe");
    const row = await setSubscriberStatus(tx, sub.id, to);
    return { email: row.email, status: row.status as SubscriberStatus };
  });
}
