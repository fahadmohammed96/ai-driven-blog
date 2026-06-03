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
import type { ChannelPostMap, Proposal } from "@blogs/contracts";
import { channelPostSchema } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { channelPosts } from "../../platform/db/schema";
import { insertContentItem, PostgresAgentProposalStore } from "../content";
import { listChannelPosts } from "./social.repo";

// RLS guard (DEBT-005, critica #8) + S2 acceptance for the `social_captions`
// gate: approving the Social Agent's proposal inserts `channel_posts` at `draft`,
// tenant-scoped (exercised as the least-privilege app_rw role; the dev superuser
// bypasses RLS). The existing Phase-2.5 per-post gate stays the final gate.

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let store: PostgresAgentProposalStore;

function channelPostMap(contentItemId: string): ChannelPostMap {
  return {
    contentItemId,
    posts: [
      { channel: "instagram", caption: "Tramonto sulla costa siciliana.", hashtags: ["#sicilia"] },
      { channel: "x", tweets: ["Una giornata lenta lungo la costa siciliana."] },
      {
        channel: "pinterest",
        title: "Costa siciliana",
        description: "Un viaggio lento al tramonto.",
        imageAssetId: ASSET,
      },
    ],
  };
}

function proposal(payload: ChannelPostMap, over: Partial<Proposal> = {}): Proposal {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: TENANT_A,
    agentId: "social",
    runId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    type: "social_captions",
    payload,
    rationale: "Deterministic: brand-voice score ≥ threshold.",
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

describe("social_captions gate (Docker, as app_rw)", () => {
  it("runs as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("approving a social_captions proposal inserts channel_posts at draft", async () => {
    const item = await withTenant(appDb, TENANT_A, (tx) =>
      insertContentItem(tx, {
        tenantId: TENANT_A,
        type: "article",
        title: "Tramonto sulla costa siciliana",
        blocks: [{ type: "paragraph", text: "Ho camminato lungo la costa." }],
      }),
    );
    const map = channelPostMap(item.id);
    await store.persist(proposal(map));

    const returned = await store.approve(TENANT_A, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    // The gate returns the source content item; its status is unchanged (no publish).
    expect(returned.id).toBe(item.id);
    expect(returned.status).toBe(item.status);

    // The posts are persisted as channel_posts at `draft` (the Phase-2.5 gate state).
    const posts = await withTenant(appDb, TENANT_A, (tx) => listChannelPosts(tx, item.id));
    expect(posts.map((p) => p.channel).sort()).toEqual(["instagram", "pinterest", "x"]);
    expect(posts.every((p) => p.status === "draft")).toBe(true);
    for (const p of posts) expect(channelPostSchema.safeParse(p.payload).success).toBe(true);

    // The proposal has left the pending queue (status → approved).
    const pending = await store.listPending(TENANT_A);
    expect(pending.some((p) => p.id === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe(false);
  });

  it("isolates the inserted posts per tenant — another tenant cannot read them", async () => {
    const item = await withTenant(appDb, TENANT_A, (tx) =>
      insertContentItem(tx, {
        tenantId: TENANT_A,
        type: "article",
        title: "Solo A",
        blocks: [{ type: "paragraph", text: "Un viaggio in Sicilia." }],
      }),
    );
    await store.persist(
      proposal(channelPostMap(item.id), {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        runId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      }),
    );
    await store.approve(TENANT_A, "cccccccc-cccc-cccc-cccc-cccccccccccc");

    // Tenant B sees no channel_posts for A's item (RLS).
    const seenByB = await withTenant(appDb, TENANT_B, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${channelPosts}`,
      );
      return Number(r.rows[0]!.n);
    });
    expect(seenByB).toBe(0);

    const forB = await withTenant(appDb, TENANT_B, (tx) => listChannelPosts(tx, item.id));
    expect(forB).toHaveLength(0);
  });
});
