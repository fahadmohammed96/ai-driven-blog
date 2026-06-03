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
import { contentItems } from "../../platform/db/schema";
import { PostgresAgentProposalStore } from "../content";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { StubLlmAdapter } from "../../platform/ai/llm";
import {
  OrchestratorAgent,
  type OrchestratorAccessors,
} from "../../platform/ai/agents/orchestrator-agent";

/**
 * Editorial Orchestrator (Slice O3) as the least-privilege runtime role (`app_rw`,
 * DEBT-005). O3 adds NO new table — it STAGES in the existing `agent_proposals`
 * (RLS + grant from T1). This proves: the `EditorialPlan` lands `pending` and is
 * listed TENANT-SCOPED (no cross-tenant leak), and — the design crux — approving
 * it is ACKNOWLEDGE-ONLY: NO `content_items` row is minted (the `content_draft`
 * default is never reached), only the status flips, `{id,status}` is returned.
 * Stub LLM → zero cost; the deterministic seed yields a valid, non-empty plan.
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
let runStore: PostgresAgentRunStore;
let proposals: PostgresAgentProposalStore;

/** Fixture accessors — the staging/RLS/acknowledge path is what this test proves. */
function fixtureAccessors(): OrchestratorAccessors {
  return {
    getContentCalendar: async () => [],
    listTrips: async () => [{ id: "t1", title: "Tour della Toscana" }],
    getTenantSettings: async () => ({
      channels: ["blog"],
      specialistAutonomy: { writer: "manual", seo: "manual", social: "manual", email: "manual" },
    }),
  };
}

function makeAgent(): OrchestratorAgent {
  return new OrchestratorAgent({
    llm: new StubLlmAdapter(),
    accessors: fixtureAccessors(),
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

  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  runStore = new PostgresAgentRunStore(appDb);
  proposals = new PostgresAgentProposalStore(appDb);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("Editorial Orchestrator (Docker, as app_rw)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("stages an editorial_plan proposal (pending) that appears in listPending, tenant-scoped", async () => {
    const proposal = await makeAgent().run({ horizonDays: 28 }, { tenantId: TENANT_A });
    expect(proposal.type).toBe("editorial_plan");
    expect(proposal.status).toBe("pending");
    expect(proposal.payload.slots.length).toBeGreaterThan(0);
    await proposals.persist(proposal);

    const pendingA = await proposals.listPending(TENANT_A);
    expect(pendingA.some((p) => p.id === proposal.id && p.type === "editorial_plan")).toBe(true);
    // RLS: the other tenant never sees A's staged plan.
    const pendingB = await proposals.listPending(TENANT_B);
    expect(pendingB.some((p) => p.id === proposal.id)).toBe(false);
  });

  it("approve is ACKNOWLEDGE-ONLY: no content_item minted, status flips, returns {id,status}", async () => {
    const proposal = await makeAgent().run({ horizonDays: 14 }, { tenantId: TENANT_A });
    await proposals.persist(proposal);

    const before = await countContentItems(TENANT_A);
    const returned = await proposals.approve(TENANT_A, proposal.id);
    const after = await countContentItems(TENANT_A);

    // The content_draft DEFAULT branch was NOT reached (no item created/published).
    expect(after).toBe(before);
    expect(returned).toEqual({ id: proposal.id, status: "approved" });
    const pending = await proposals.listPending(TENANT_A);
    expect(pending.some((p) => p.id === proposal.id)).toBe(false);
  });

  it("IDEMPOTENT staging: re-running + re-persisting the same input dedupes (stable id)", async () => {
    const triggeredAt = new Date("2026-06-02T09:00:00.000Z");
    const p1 = await makeAgent().run({ horizonDays: 90 }, { tenantId: TENANT_A, triggeredAt });
    const p2 = await makeAgent().run({ horizonDays: 90 }, { tenantId: TENANT_A, triggeredAt });
    expect(p2.id).toBe(p1.id);
    await proposals.persist(p1);
    await proposals.persist(p2); // onConflictDoNothing(id) → no duplicate

    const pending = await proposals.listPending(TENANT_A);
    expect(pending.filter((p) => p.id === p1.id)).toHaveLength(1);
  });
});
