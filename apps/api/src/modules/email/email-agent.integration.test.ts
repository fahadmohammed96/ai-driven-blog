import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { EmailDraft, Proposal } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import {
  insertContentItem,
  PostgresAgentProposalStore,
  ProposalNotPendingError,
  ProposalNotFoundError,
} from "../content";
import type { EmailMessage, EmailPort } from "./email.port";
import { insertSubscriber, setSubscriberStatus, addThemes } from "./subscribers.repo";
import { makeEmailDraftSink } from "./email-draft-sink";

/**
 * Email Agent gate (Slice S3), as the least-privilege app_rw role (RLS enforced).
 * Asserts the propose-only invariant at the gate: `approve` of an `email_draft`
 * sends to the theme's confirmed-opt-in segment, is IDEMPOTENT (re-approving
 * never re-sends), and is tenant-scoped (no cross-tenant send/leak).
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;

/** A counting EmailPort: records every delivery so we can assert "sent once". */
class CountingEmailPort implements EmailPort {
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

function emailDraft(over: Partial<EmailDraft> = {}): EmailDraft {
  return {
    contentItemId: "00000000-0000-0000-0000-000000000000",
    theme: "viaggi",
    subject: "Le mie tappe siciliane",
    preheader: "Un racconto dalla costa",
    body: "<h1>Sicilia</h1>\n<p>Tramonti e sapori.</p>",
    ctaText: "Leggi l'articolo",
    ctaUrl: "https://blog.test/articles/x",
    ...over,
  };
}

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: TENANT_A,
    agentId: "email",
    runId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    type: "email_draft",
    payload: emailDraft(),
    rationale: "Deterministic: brand-voice score ≥ threshold; no LLM used.",
    estimatedCostUsd: 0,
    tokensUsed: { input: 0, output: 0, cached: 0 },
    status: "pending",
    requiresHumanGate: true,
    truncated: false,
    auditRecorded: true,
    agentDefinitionVersion: "v1-deadbeefdeadbeef",
    createdAt: new Date(),
    ...over,
  };
}

/** Seed a confirmed subscriber opted into `theme` for the given tenant. */
async function seedConfirmedSubscriber(
  tenantId: string,
  email: string,
  theme: string,
): Promise<void> {
  await withTenant(appDb, tenantId, async (tx) => {
    const sub = await insertSubscriber(tx, { tenantId, email, token: `tok-${email}` });
    await setSubscriberStatus(tx, sub.id, "confirmed");
    await addThemes(tx, { tenantId, subscriberId: sub.id, themes: [theme] });
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("email_draft gate (Docker, as app_rw)", () => {
  it("runs as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("approve sends to the confirmed segment ONCE and re-approving never re-sends", async () => {
    // alice: confirmed 'viaggi'; bob: confirmed 'natura' (must NOT receive);
    // carol: 'viaggi' but only pending (must NOT receive).
    await seedConfirmedSubscriber(TENANT_A, "alice@test.dev", "viaggi");
    await seedConfirmedSubscriber(TENANT_A, "bob@test.dev", "natura");
    await withTenant(appDb, TENANT_A, async (tx) => {
      const carol = await insertSubscriber(tx, {
        tenantId: TENANT_A,
        email: "carol@test.dev",
        token: "tok-carol",
      });
      await addThemes(tx, { tenantId: TENANT_A, subscriberId: carol.id, themes: ["viaggi"] });
    });

    const item = await withTenant(appDb, TENANT_A, (tx) =>
      insertContentItem(tx, { tenantId: TENANT_A, type: "article", title: "Sicilia", blocks: [] }),
    );

    const port = new CountingEmailPort();
    const store = new PostgresAgentProposalStore(appDb, {
      emailSink: makeEmailDraftSink({
        db: appDb,
        email: port,
        unsubscribeBaseUrl: "https://blog.test/newsletter/unsubscribe",
      }),
    });

    await store.persist(
      proposal({ payload: emailDraft({ contentItemId: item.id, theme: "viaggi" }) }),
    );

    // First approval: sends to the 'viaggi' confirmed segment (alice only).
    const approved = await store.approve(TENANT_A, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(approved.id).toBe(item.id);
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]!.to).toBe("alice@test.dev");
    expect(port.sent[0]!.subject).toBe("Le mie tappe siciliane");

    // Re-approval: the proposal is no longer pending → no second send (idempotent).
    await expect(
      store.approve(TENANT_A, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    ).rejects.toBeInstanceOf(ProposalNotPendingError);
    expect(port.sent).toHaveLength(1);
  });

  it("is tenant-scoped: tenant B cannot approve (nor send) tenant A's draft", async () => {
    const item = await withTenant(appDb, TENANT_A, (tx) =>
      insertContentItem(tx, { tenantId: TENANT_A, type: "article", title: "Altro", blocks: [] }),
    );
    const port = new CountingEmailPort();
    const store = new PostgresAgentProposalStore(appDb, {
      emailSink: makeEmailDraftSink({
        db: appDb,
        email: port,
        unsubscribeBaseUrl: "https://blog.test/newsletter/unsubscribe",
      }),
    });
    await store.persist(
      proposal({
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        payload: emailDraft({ contentItemId: item.id, theme: "viaggi" }),
      }),
    );

    // Tenant B cannot see (RLS) tenant A's staged proposal → not found, no send.
    await expect(
      store.approve(TENANT_B, "cccccccc-cccc-cccc-cccc-cccccccccccc"),
    ).rejects.toBeInstanceOf(ProposalNotFoundError);
    expect(port.sent).toHaveLength(0);
  });
});
