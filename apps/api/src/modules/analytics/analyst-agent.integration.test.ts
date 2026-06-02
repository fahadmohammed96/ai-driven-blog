import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { affiliateClicks, affiliateLinks, contentItems } from "../../platform/db/schema";
import { PostgresAgentProposalStore } from "../content";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { StubLlmAdapter } from "../../platform/ai/llm";
import { AnalyticsService } from "./analytics.service";
import { createAnalyticsSources } from "./sources";
import { AnalystAgent } from "./agents/analyst-agent";

/**
 * Analyst Agent (Slice O1) as the least-privilege runtime role (`app_rw`, DEBT-005):
 * proves the agent reads `metric_snapshots` TENANT-SCOPED (RLS, no cross-tenant
 * leak), stages an `analyst_insight` proposal in `agent_proposals` (pending +
 * listed), and — the design crux — that approving it is ACKNOWLEDGE-ONLY: NO
 * `content_items` row is minted (the `content_draft` default is never reached),
 * only the status flips and `{id,status}` is returned.
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
let service: AnalyticsService;
let runStore: PostgresAgentRunStore;
let proposals: PostgresAgentProposalStore;

function makeAgent(): AnalystAgent {
  return new AnalystAgent({
    llm: new StubLlmAdapter(),
    accessors: { dashboard: (tenantId) => service.getDashboard(tenantId) },
    store: runStore,
  });
}

async function countContentItems(tenantId: string): Promise<number> {
  return withTenant(appDb, tenantId, async (tx) => {
    const r = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${contentItems}`,
    );
    return Number(r.rows[0]!.n);
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

  // Provision + connect as the least-privilege runtime role (DEBT-005), so the
  // metric_snapshots/agent_proposals grants are proven at runtime.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  service = new AnalyticsService(appDb, createAnalyticsSources());
  runStore = new PostgresAgentRunStore(appDb);
  proposals = new PostgresAgentProposalStore(appDb);

  // Seed an internal affiliate signal for A only (to prove RLS isolation on read),
  // then ingest both tenants (the external stubs populate deterministically).
  await withTenant(appDb, TENANT_A, async (tx) => {
    const [link] = await tx
      .insert(affiliateLinks)
      .values({ tenantId: TENANT_A, code: "an-a", targetUrl: "https://example.com/a", channel: "blog" })
      .returning();
    await tx.insert(affiliateClicks).values({ tenantId: TENANT_A, linkId: link!.id, channel: "blog" });
  });
  await service.ingestAll(TENANT_A);
  await service.ingestAll(TENANT_B);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("Analyst Agent (Docker, as app_rw)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("reads metric_snapshots TENANT-SCOPED — no cross-tenant leak", async () => {
    const dashA = await service.getDashboard(TENANT_A);
    const dashB = await service.getDashboard(TENANT_B);
    // A has its own affiliate click; B has none of A's internal data.
    expect(dashA.rows.some((r) => r.source === "affiliate")).toBe(true);
    expect(dashB.rows.some((r) => r.source === "affiliate")).toBe(false);
  });

  it("stages an analyst_insight proposal (pending) that appears in listPending", async () => {
    const proposal = await makeAgent().run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT_A });
    expect(proposal.type).toBe("analyst_insight");
    expect(proposal.status).toBe("pending");
    expect(proposal.payload.insights.length).toBeGreaterThan(0);
    await proposals.persist(proposal);

    const pendingA = await proposals.listPending(TENANT_A);
    expect(pendingA.some((p) => p.id === proposal.id && p.type === "analyst_insight")).toBe(true);
    // RLS: the other tenant never sees A's staged proposal.
    const pendingB = await proposals.listPending(TENANT_B);
    expect(pendingB.some((p) => p.id === proposal.id)).toBe(false);
  });

  it("approve is ACKNOWLEDGE-ONLY: no content_item minted, status flips, returns {id,status}", async () => {
    const proposal = await makeAgent().run({ periodDays: 7, mode: "sync" }, { tenantId: TENANT_A });
    await proposals.persist(proposal);

    const before = await countContentItems(TENANT_A);
    const returned = await proposals.approve(TENANT_A, proposal.id);
    const after = await countContentItems(TENANT_A);

    // The content_draft DEFAULT branch was NOT reached (no item created).
    expect(after).toBe(before);
    // Acknowledge-only result shape: just the id + the new status.
    expect(returned).toEqual({ id: proposal.id, status: "approved" });
    // The proposal is no longer pending.
    const pending = await proposals.listPending(TENANT_A);
    expect(pending.some((p) => p.id === proposal.id)).toBe(false);
  });

  it("IDEMPOTENT staging: re-running + re-persisting the same input dedupes (stable id)", async () => {
    const triggeredAt = new Date("2026-06-02T09:00:00.000Z");
    const p1 = await makeAgent().run({ periodDays: 90, mode: "sync" }, { tenantId: TENANT_A, triggeredAt });
    const p2 = await makeAgent().run({ periodDays: 90, mode: "sync" }, { tenantId: TENANT_A, triggeredAt });
    expect(p2.id).toBe(p1.id);
    await proposals.persist(p1);
    await proposals.persist(p2); // onConflictDoNothing(id) → no duplicate

    const pending = await proposals.listPending(TENANT_A);
    expect(pending.filter((p) => p.id === p1.id)).toHaveLength(1);
  });
});
