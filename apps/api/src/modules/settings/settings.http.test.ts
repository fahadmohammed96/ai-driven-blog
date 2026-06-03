import "reflect-metadata";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { type TenantSettings } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { DbCredentialStore } from "../../platform/integration";
import { LLM_ANTHROPIC_CONNECTOR } from "../../platform/ai/provider-registry";
import { TenancyService } from "../tenancy";
import { SettingsController } from "./settings.controller";
import { SETTINGS_CREDENTIAL_STORE } from "./settings.tokens";
import { getTenantSettings, upsertTenantSettings } from "./settings.repo";

const MASTER = "settings-http-master-secret";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
// The founder tenant the controller runs as (set via FOUNDER_TENANT_ID below).
const TENANT = "44444444-4444-4444-4444-444444444444";
// A second tenant whose settings must NEVER be read/written by the founder (RLS).
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, tenant_settings, connector_credentials TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder'), ($2,'other','Other')`,
    [TENANT, OTHER],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [SettingsController],
    providers: [
      TenancyService,
      { provide: DB, useValue: db },
      { provide: SETTINGS_CREDENTIAL_STORE, useValue: new DbCredentialStore(db, MASTER) },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

const FOUNDER_SETTINGS: TenantSettings = {
  brandVoice: { tone: "personale e curioso", audience: "viaggiatori indipendenti" },
  specialistAutonomy: {
    writer: "semi-auto",
    seo: "manual",
    social: "manual",
    email: "auto-within-limits",
  },
  channels: [
    { channel: "instagram", enabled: true },
    { channel: "x", enabled: false },
    { channel: "pinterest", enabled: true },
  ],
  budgetUsdMonthly: 50,
  aiProvider: { connector: "stub" },
  auditPolicy: "obbligatorio",
  externalResearch: { enabled: false },
};

describe("tenant settings HTTP (GET/PUT, persistence + RLS)", () => {
  it("returns defaults (manual autonomy everywhere) when no settings row exists", async () => {
    const res = await request(app.getHttpServer()).get("/settings").expect(200);
    const body = res.body as TenantSettings;
    expect(body.specialistAutonomy).toEqual({
      writer: "manual",
      seo: "manual",
      social: "manual",
      email: "manual",
    });
    expect(body.brandVoice).toEqual({ tone: "", audience: "" });
    expect(body.channels.map((c) => c.channel)).toEqual(["instagram", "x", "pinterest"]);
  });

  it("persists settings via PUT and reads them back via GET", async () => {
    const put = await request(app.getHttpServer())
      .put("/settings")
      .send(FOUNDER_SETTINGS)
      .expect(200);
    expect(put.body).toEqual(FOUNDER_SETTINGS);

    const get = await request(app.getHttpServer()).get("/settings").expect(200);
    expect(get.body).toEqual(FOUNDER_SETTINGS);
  });

  it("updates an existing settings row on a second PUT (upsert, one row per tenant)", async () => {
    const next: TenantSettings = {
      ...FOUNDER_SETTINGS,
      brandVoice: { tone: "diretto", audience: "famiglie" },
    };
    await request(app.getHttpServer()).put("/settings").send(next).expect(200);
    const get = await request(app.getHttpServer()).get("/settings").expect(200);
    expect((get.body as TenantSettings).brandVoice).toEqual({ tone: "diretto", audience: "famiglie" });
  });

  it("fills omitted fields with defaults on PUT", async () => {
    const res = await request(app.getHttpServer())
      .put("/settings")
      .send({ brandVoice: { tone: "minimale" } })
      .expect(200);
    const body = res.body as TenantSettings;
    expect(body.brandVoice).toEqual({ tone: "minimale", audience: "" });
    expect(body.specialistAutonomy.writer).toBe("manual");
    expect(body.channels.map((c) => c.channel)).toEqual(["instagram", "x", "pinterest"]);
  });

  it("rejects an invalid autonomy level with 400", async () => {
    await request(app.getHttpServer())
      .put("/settings")
      .send({ specialistAutonomy: { writer: "full-self-driving" } })
      .expect(400);
  });

  it("RLS isolation: the founder cannot read or overwrite another tenant's settings", async () => {
    const foreign: TenantSettings = {
      brandVoice: { tone: "voce di un altro", audience: "altri" },
      specialistAutonomy: {
        writer: "auto-within-limits",
        seo: "auto-within-limits",
        social: "auto-within-limits",
        email: "auto-within-limits",
      },
      channels: [
        { channel: "instagram", enabled: false },
        { channel: "x", enabled: true },
        { channel: "pinterest", enabled: false },
      ],
      budgetUsdMonthly: 50,
      aiProvider: { connector: "stub" },
      auditPolicy: "best-effort",
      externalResearch: { enabled: true },
    };
    // Seed OTHER's settings directly under OTHER's tenant context.
    await withTenant(db, OTHER, (tx) => upsertTenantSettings(tx, OTHER, foreign));

    // The founder (controller tenant) never sees OTHER's settings.
    const get = await request(app.getHttpServer()).get("/settings").expect(200);
    expect(get.body).not.toEqual(foreign);

    // The founder's PUT writes the founder's own row and leaves OTHER's untouched.
    await request(app.getHttpServer())
      .put("/settings")
      .send({ ...FOUNDER_SETTINGS, brandVoice: { tone: "founder again", audience: "suoi" } })
      .expect(200);
    const otherAfter = await withTenant(db, OTHER, (tx) => getTenantSettings(tx));
    expect(otherAfter).toEqual(foreign);
  });

  it("persists the audit policy via PUT", async () => {
    await request(app.getHttpServer())
      .put("/settings")
      .send({ ...FOUNDER_SETTINGS, auditPolicy: "best-effort" })
      .expect(200);
    const get = await request(app.getHttpServer()).get("/settings").expect(200);
    expect((get.body as TenantSettings).auditPolicy).toBe("best-effort");
  });

  it("BYOK: a saved apiKey is sealed (never plaintext) and flips aiProvider to anthropic", async () => {
    const put = await request(app.getHttpServer())
      .put("/settings")
      .send({ ...FOUNDER_SETTINGS, apiKey: "sk-founder-byok-probe" })
      .expect(200);
    const body = put.body as TenantSettings & { apiKey?: unknown };

    // The key never round-trips: aiProvider mirrors "configured", the secret is gone.
    expect(body.aiProvider).toEqual({ connector: "anthropic" });
    expect(body.apiKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("sk-founder-byok-probe");

    // GET reflects "configurata" (anthropic) and still never exposes the key.
    const get = await request(app.getHttpServer()).get("/settings").expect(200);
    expect((get.body as TenantSettings).aiProvider).toEqual({ connector: "anthropic" });
    expect(JSON.stringify(get.body)).not.toContain("sk-founder-byok-probe");

    // The credential is stored ENCRYPTED in connector_credentials (AES-256-GCM).
    const { rows } = await adminPool.query<{ access_token: string }>(
      `SELECT access_token FROM connector_credentials WHERE tenant_id = $1 AND connector = $2`,
      [TENANT, LLM_ANTHROPIC_CONNECTOR],
    );
    expect(rows[0]!.access_token).not.toContain("sk-founder-byok-probe");

    // It decrypts back to the original key with the same master secret (so
    // ProviderRegistry can build the per-tenant port).
    const store = new DbCredentialStore(db, MASTER);
    const token = await store.load(TENANT, LLM_ANTHROPIC_CONNECTOR);
    expect(token?.accessToken).toBe("sk-founder-byok-probe");
  });

  it("a PUT without apiKey leaves the stored key untouched", async () => {
    // Save a key, then PUT plain settings (no apiKey) — the credential survives.
    await request(app.getHttpServer())
      .put("/settings")
      .send({ ...FOUNDER_SETTINGS, apiKey: "sk-keep-me" })
      .expect(200);
    await request(app.getHttpServer()).put("/settings").send(FOUNDER_SETTINGS).expect(200);

    const store = new DbCredentialStore(db, MASTER);
    const token = await store.load(TENANT, LLM_ANTHROPIC_CONNECTOR);
    expect(token?.accessToken).toBe("sk-keep-me");
  });
});
