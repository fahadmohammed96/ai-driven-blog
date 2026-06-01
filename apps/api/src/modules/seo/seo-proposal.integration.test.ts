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
import type { Proposal, SeoProposal } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { contentItems } from "../../platform/db/schema";
import {
  insertContentItem,
  getContentItem,
  annotateSeoProposal,
  PostgresAgentProposalStore,
} from "../content";

// RLS guard (DEBT-005, critica #8) for the NEW `content_items.seo_proposal`
// column — written BEFORE the migration: a SEO annotation written for one tenant
// must be invisible to another, exercised as the least-privilege `app_rw` role
// (the dev superuser bypasses RLS). Plus the S1 acceptance: save+retrieve the
// column, and approve a `seo_suggestions` proposal → the column is annotated.

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

function seoProposal(contentItemId: string, over: Partial<SeoProposal> = {}): SeoProposal {
  return {
    contentItemId,
    title: "Sicilia al tramonto",
    metaDescription: "Un viaggio lento lungo la costa siciliana.",
    primaryKeyword: "sicilia",
    slug: "sicilia-al-tramonto",
    internalLinks: [],
    readabilityScore: 65.5,
    ...over,
  };
}

function proposal(seo: SeoProposal, over: Partial<Proposal> = {}): Proposal {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: TENANT_A,
    agentId: "seo",
    runId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    type: "seo_suggestions",
    payload: seo,
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

describe("content_items.seo_proposal (Docker, as app_rw)", () => {
  it("runs as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("saves and retrieves a SEO annotation under the tenant scope", async () => {
    const item = await withTenant(appDb, TENANT_A, async (tx) => {
      const created = await insertContentItem(tx, {
        tenantId: TENANT_A,
        type: "article",
        title: "Bozza",
        blocks: [{ type: "paragraph", text: "Ho camminato lungo la costa." }],
      });
      const seo = seoProposal(created.id);
      const annotated = await annotateSeoProposal(tx, created.id, seo);
      // The annotation is written and the publication status is untouched (non-blocking).
      expect(annotated.seoProposal).toEqual(seo);
      expect(annotated.status).toBe(created.status);
      return created;
    });

    const reread = await withTenant(appDb, TENANT_A, (tx) => getContentItem(tx, item.id));
    expect(reread?.seoProposal?.slug).toBe("sicilia-al-tramonto");
    expect(reread?.seoProposal?.contentItemId).toBe(item.id);
  });

  it("isolates the annotation per tenant — another tenant cannot read it", async () => {
    const item = await withTenant(appDb, TENANT_A, async (tx) => {
      const created = await insertContentItem(tx, {
        tenantId: TENANT_A,
        type: "article",
        title: "Solo A",
        blocks: [],
      });
      await annotateSeoProposal(tx, created.id, seoProposal(created.id, { slug: "solo-a" }));
      return created;
    });

    // Tenant B sees no row at all (RLS), so it can never read A's seo_proposal.
    const seenByB = await withTenant(appDb, TENANT_B, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${contentItems} where seo_proposal is not null`,
      );
      return Number(r.rows[0]!.n);
    });
    const itemForB = await withTenant(appDb, TENANT_B, (tx) => getContentItem(tx, item.id));
    expect(seenByB).toBe(0);
    expect(itemForB).toBeNull();
  });

  it("approving a seo_suggestions proposal annotates the column (non-blocking)", async () => {
    const created = await withTenant(appDb, TENANT_A, (tx) =>
      insertContentItem(tx, {
        tenantId: TENANT_A,
        type: "article",
        title: "Da ottimizzare",
        blocks: [{ type: "paragraph", text: "Un viaggio in Sicilia." }],
      }),
    );
    const seo = seoProposal(created.id, { slug: "da-ottimizzare", primaryKeyword: "viaggio" });
    await store.persist(
      proposal(seo, { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", runId: "dddddddd-dddd-dddd-dddd-dddddddddddd" }),
    );

    const returned = await store.approve(TENANT_A, "cccccccc-cccc-cccc-cccc-cccccccccccc");
    // The gate returns the annotated content item; status is unchanged (no publish transition).
    expect(returned.id).toBe(created.id);
    expect(returned.status).toBe(created.status);
    expect(returned.seoProposal?.primaryKeyword).toBe("viaggio");

    // The annotation is persisted on the content item…
    const reread = await withTenant(appDb, TENANT_A, (tx) => getContentItem(tx, created.id));
    expect(reread?.seoProposal?.slug).toBe("da-ottimizzare");

    // …and the proposal is now approved.
    const pending = await store.listPending(TENANT_A);
    expect(pending.some((p) => p.id === "cccccccc-cccc-cccc-cccc-cccccccccccc")).toBe(false);
  });
});
