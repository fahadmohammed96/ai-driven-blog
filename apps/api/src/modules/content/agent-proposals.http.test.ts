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
import { withSettingsDefaults, type EmailDraft } from "@blogs/contracts";
import { DB, LLM, EMAIL_DRAFT_SINK } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole } from "../../platform/db/bootstrap";
import { aiUsageEvents, agentProposals } from "../../platform/db/schema";
import { TenancyService } from "../tenancy";
import { upsertTenantSettings } from "../settings";
import { AgentProposalsController } from "./agent-proposals.controller";
import { insertContentItem } from "./content.repo";
import type { EmailDraftSink } from "./agent-proposal-store";

// HTTP test for the agentic "Code proposte" surface (Slice T1): the Writer's
// proposal is staged, the budget headroom is exposed at the gate, and approve
// injects the payload into the Phase-1 state machine. Runs as the least-privilege
// app_rw role (RLS enforced) with the offline StubLlmAdapter (zero cost).

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";

// A fake email_draft sink: records sends so the UNIFIED gate can be asserted to
// dispatch on approval without real SMTP. The production sink is built in
// InfraModule; here it stands in for the EMAIL_DRAFT_SINK token.
const sentEmails: { tenantId: string; draft: EmailDraft }[] = [];
const fakeEmailSink: EmailDraftSink = {
  send: async (tenantId, draft) => {
    sentEmails.push({ tenantId, draft });
    return { recipients: [] };
  },
};

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let adminDbPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

beforeAll(async () => {
  // No ANTHROPIC_API_KEY → the Writer uses the deterministic stub (zero cost).
  delete process.env.ANTHROPIC_API_KEY;
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder')`, [
    TENANT,
  ]);

  const admin = createDb(container.getConnectionUri());
  adminDbPool = admin.pool;
  await ensureAppRole(admin.db, "app_rw", "app_rw");
  ({ db, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  // Seed a $2.50 spend this month so the residual budget is a non-default,
  // verifiable number: cap(50, default) − 2.5 = 47.5.
  await withTenant(db, TENANT, (tx) =>
    tx.insert(aiUsageEvents).values({
      tenantId: TENANT,
      agentName: "writer",
      model: "balanced",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: "2.500000",
    }),
  );

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [AgentProposalsController],
    providers: [
      TenancyService,
      { provide: DB, useValue: db },
      { provide: LLM, useValue: {} },
      { provide: EMAIL_DRAFT_SINK, useValue: fakeEmailSink },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await adminDbPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("agent-proposals HTTP (Slice T1)", () => {
  let proposalId: string;

  it("generates a Writer proposal and stages it as pending", async () => {
    const res = await request(app.getHttpServer())
      .post("/agent-proposals/generate")
      .send({ brief: "Un weekend a Kyoto", title: "Kyoto in due giorni" })
      .expect(201);
    expect(res.body.id).toMatch(/[0-9a-f-]{36}/);
    expect(res.body.status).toBe("pending");
    proposalId = res.body.id;
  });

  it("lists the pending proposal with cost, reasoning, version and budget headroom", async () => {
    const res = await request(app.getHttpServer()).get("/agent-proposals").expect(200);
    // Budget headroom shown at the gate (critica #13): 50 − 2.5 = 47.5.
    expect(res.body.tenantBudgetResiduoUsd).toBeCloseTo(47.5, 6);

    const items = res.body.proposals as Array<Record<string, unknown>>;
    const mine = items.find((p) => p.id === proposalId);
    expect(mine).toBeTruthy();
    expect(mine!.type).toBe("content_draft");
    expect(mine!.agentName).toBe("writer");
    expect(mine!.title).toBe("Kyoto in due giorni");
    expect(typeof mine!.estimatedCostUsd).toBe("number");
    expect(typeof mine!.agentDefinitionVersion).toBe("string");
    expect((mine!.agentDefinitionVersion as string).length).toBeGreaterThan(0);
    expect(Array.isArray(mine!.reasoning)).toBe(true);
  });

  it("approve injects the payload into the Phase-1 state machine and clears the queue", async () => {
    await request(app.getHttpServer())
      .post(`/agent-proposals/${proposalId}/approve`)
      .expect(200)
      .expect((r) => {
        expect(r.body.id).toMatch(/[0-9a-f-]{36}/);
        // The Phase-1 state machine advanced the fresh draft to `review`.
        expect(r.body.status).toBe("review");
      });

    // The proposal left the pending queue (status → approved).
    const after = await request(app.getHttpServer()).get("/agent-proposals").expect(200);
    const stillPending = (after.body.proposals as Array<{ id: string }>).find(
      (p) => p.id === proposalId,
    );
    expect(stillPending).toBeUndefined();
  });

  it("approving an already-approved proposal is a 409 (idempotent gate)", async () => {
    await request(app.getHttpServer()).post(`/agent-proposals/${proposalId}/approve`).expect(409);
  });

  it("approves an email_draft from the UNIFIED queue (sink wired) → 200 and dispatches", async () => {
    // The subject article must exist (validated before the send).
    const item = await withTenant(db, TENANT, (tx) =>
      insertContentItem(tx, { tenantId: TENANT, type: "article", title: "Fonte newsletter", blocks: [] }),
    );
    const emailProposalId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const draft: EmailDraft = {
      contentItemId: item.id,
      theme: "viaggi",
      subject: "Dalla coda unificata",
      preheader: "Anteprima",
      body: "<p>Corpo</p>",
      ctaText: "Leggi",
      ctaUrl: "https://blog.test/x",
    };
    await withTenant(db, TENANT, (tx) =>
      tx.insert(agentProposals).values({
        id: emailProposalId,
        tenantId: TENANT,
        agentName: "email",
        runId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        type: "email_draft",
        payload: draft,
        rationale: "seeded",
        estimatedCostUsd: "0.000000",
        tokensUsed: { input: 0, output: 0, cached: 0 },
        agentDefinitionVersion: "v1-test",
      }),
    );

    const before = sentEmails.length;
    // Without the injected sink the unified store throws EmailSinkNotConfiguredError
    // → 500; with it the draft is approved (200) and dispatched exactly once.
    await request(app.getHttpServer())
      .post(`/agent-proposals/${emailProposalId}/approve`)
      .expect(200);
    expect(sentEmails.length).toBe(before + 1);
    expect(sentEmails.at(-1)!.draft.subject).toBe("Dalla coda unificata");
  });

  // Slice T2: the audit policy gates an UN-audited proposal (no ai_agent_runs row
  // for its run_id → auditRecorded=false). Stage one directly and toggle policy.
  const unauditedId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  async function setAuditPolicy(policy: "obbligatorio" | "best-effort") {
    await withTenant(db, TENANT, (tx) =>
      upsertTenantSettings(tx, TENANT, withSettingsDefaults({ auditPolicy: policy })),
    );
  }

  async function listIds(): Promise<string[]> {
    const res = await request(app.getHttpServer()).get("/agent-proposals").expect(200);
    return (res.body.proposals as Array<{ id: string }>).map((p) => p.id);
  }

  it("withholds an un-audited proposal under auditPolicy=obbligatorio (default)", async () => {
    // run_id points at no ai_agent_runs row → auditRecorded=false.
    await withTenant(db, TENANT, (tx) =>
      tx.insert(agentProposals).values({
        id: unauditedId,
        tenantId: TENANT,
        agentName: "writer",
        runId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        type: "content_draft",
        payload: { draft: "Bozza senza audit." },
        rationale: "seeded",
        estimatedCostUsd: "0.000000",
        tokensUsed: { input: 0, output: 0, cached: 0 },
        agentDefinitionVersion: "v1-test",
      }),
    );

    await setAuditPolicy("obbligatorio");
    expect(await listIds()).not.toContain(unauditedId);
  });

  it("surfaces the same un-audited proposal under auditPolicy=best-effort", async () => {
    await setAuditPolicy("best-effort");
    expect(await listIds()).toContain(unauditedId);
  });
});
