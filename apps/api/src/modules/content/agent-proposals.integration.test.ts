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
import type { Proposal } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { agentProposals } from "../../platform/db/schema";
import { PostgresAgentProposalStore } from "./agent-proposal-store";

// RLS guard (DEBT-005, critica #8) for the NEW agent_proposals staging table —
// written BEFORE the migration: a proposal staged for one tenant must be
// invisible to another, exercised as the least-privilege app_rw role (the role
// that actually has RLS enforced, since the dev superuser bypasses it).

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let store: PostgresAgentProposalStore;

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: TENANT_A,
    agentId: "writer",
    runId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    type: "content_draft",
    payload: { draft: "Ho vissuto questa tappa con calma.", usedContext: [], system: "voice" },
    rationale: "Completed in 1 step(s).",
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
  store = new PostgresAgentProposalStore(appDb);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("agent_proposals RLS (Docker, as app_rw)", () => {
  it("runs as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("isolates staged proposals per tenant — another tenant cannot read them", async () => {
    await store.persist(proposal());

    const seenByA = await withTenant(appDb, TENANT_A, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${agentProposals}`,
      );
      return Number(r.rows[0]!.n);
    });
    const seenByB = await withTenant(appDb, TENANT_B, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${agentProposals}`,
      );
      return Number(r.rows[0]!.n);
    });

    expect(seenByA).toBeGreaterThanOrEqual(1);
    expect(seenByB).toBe(0);
  });

  it("listPending is tenant-scoped: tenant B sees none of tenant A's proposals", async () => {
    const forA = await store.listPending(TENANT_A);
    const forB = await store.listPending(TENANT_B);
    expect(forA.length).toBeGreaterThanOrEqual(1);
    expect(forA.every((p) => p.status === "pending")).toBe(true);
    expect(forB.length).toBe(0);
  });
});
