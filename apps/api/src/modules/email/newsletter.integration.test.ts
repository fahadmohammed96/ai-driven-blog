import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { SmtpEmailClient } from "./smtp";
import { subscribe, confirm } from "./optin";
import { segmentForTheme, sendNewsletterToSegment } from "./newsletter";
import { findSubscriberByEmail } from "./subscribers.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "11111111-1111-1111-1111-111111111111";

let pg: StartedPostgreSqlContainer;
let mailhog: StartedTestContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let smtp: SmtpEmailClient;
let mailhogUrl: string;

async function tokenFor(email: string): Promise<string> {
  const sub = await withTenant(db, TENANT, (tx) => findSubscriberByEmail(tx, email));
  if (!sub) throw new Error(`no subscriber ${email}`);
  return sub.confirmToken;
}

async function mailhogMessages(): Promise<{ to: string[]; subject: string }[]> {
  const res = await fetch(`${mailhogUrl}/api/v2/messages`);
  const body = (await res.json()) as {
    items: { Content: { Headers: { To: string[]; Subject: string[] } } }[];
  };
  return body.items.map((m) => ({
    to: m.Content.Headers.To,
    subject: m.Content.Headers.Subject?.[0] ?? "",
  }));
}

async function clearMailhog(): Promise<void> {
  await fetch(`${mailhogUrl}/api/v1/messages`, { method: "DELETE" });
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: pg.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, subscribers, subscriptions TO appuser`,
  );
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder')`, [TENANT]);
  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${pg.getHost()}:${pg.getPort()}/${pg.getDatabase()}`,
  ));

  mailhog = await new GenericContainer("mailhog/mailhog")
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/api/v2/messages", 8025))
    .start();
  mailhogUrl = `http://${mailhog.getHost()}:${mailhog.getMappedPort(8025)}`;
  smtp = new SmtpEmailClient({ host: mailhog.getHost(), port: mailhog.getMappedPort(1025) });
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await pg?.stop();
  await mailhog?.stop();
});

describe("newsletter: double opt-in + segmented send (Mailhog)", () => {
  it("delivers only to confirmed subscribers of the targeted theme", async () => {
    // alice: party, confirmed
    expect((await subscribe({ db, email: smtp }, sub("alice@test.dev", ["party"]))).status).toBe("pending");
    await confirm({ db }, { tenantId: TENANT, token: await tokenFor("alice@test.dev") });
    // bob: natura, confirmed (different theme — must NOT receive a party newsletter)
    await subscribe({ db, email: smtp }, sub("bob@test.dev", ["natura"]));
    await confirm({ db }, { tenantId: TENANT, token: await tokenFor("bob@test.dev") });
    // carol: party, but NEVER confirms (pending — must NOT receive)
    await subscribe({ db, email: smtp }, sub("carol@test.dev", ["party"]));

    // The segment is exactly the confirmed 'party' subscribers.
    expect(await segmentForTheme(db, TENANT, "party")).toEqual(["alice@test.dev"]);

    await clearMailhog(); // isolate the newsletter from the confirmation emails
    const { recipients } = await sendNewsletterToSegment({ db, email: smtp }, {
      tenantId: TENANT,
      theme: "party",
      subject: "Serata in spiaggia",
      html: "<h1>Ci vediamo!</h1>",
      unsubscribeBaseUrl: "https://blog.test/newsletter/unsubscribe",
    });
    expect(recipients).toEqual(["alice@test.dev"]);

    const inbox = await mailhogMessages();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toContain("alice@test.dev");
    expect(inbox[0]!.subject).toBe("Serata in spiaggia");
    expect(inbox.flatMap((m) => m.to)).not.toContain("bob@test.dev");
    expect(inbox.flatMap((m) => m.to)).not.toContain("carol@test.dev");
  });

  it("tracks the double opt-in audit trail (consent request + confirmation)", async () => {
    const alice = await withTenant(db, TENANT, (tx) => findSubscriberByEmail(tx, "alice@test.dev"));
    const carol = await withTenant(db, TENANT, (tx) => findSubscriberByEmail(tx, "carol@test.dev"));
    expect(alice?.status).toBe("confirmed");
    expect(alice?.requestedAt).toBeInstanceOf(Date);
    expect(alice?.confirmedAt).toBeInstanceOf(Date);
    // carol asked but never confirmed → no confirmation timestamp
    expect(carol?.status).toBe("pending");
    expect(carol?.confirmedAt).toBeNull();
  });

  it("sends a confirmation email on subscribe (the opt-in mechanism)", async () => {
    await clearMailhog();
    await subscribe({ db, email: smtp }, sub("dave@test.dev", ["cultura"]));
    const inbox = await mailhogMessages();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toContain("dave@test.dev");
    expect(inbox[0]!.subject).toBe("Conferma la tua iscrizione");
  });
});

function sub(email: string, themes: string[]) {
  return {
    tenantId: TENANT,
    email,
    themes,
    confirmBaseUrl: "https://blog.test/newsletter/confirm",
  };
}
