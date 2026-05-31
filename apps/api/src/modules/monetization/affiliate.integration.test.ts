import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { insertContentItem } from "../content";
import {
  countClicksByArticle,
  countClicksByChannel,
  countClicksByLink,
  DuplicateCodeError,
  getAffiliateLinkByCode,
  insertAffiliateLink,
  listLinksWithClicks,
  recordClick,
} from "./affiliate.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Provision the real least-privilege runtime role (DEBT-005) and connect as it,
  // so this exercises the grants the redirector/tracking need at runtime.
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

describe("affiliate links + clicks — runtime RLS via the app role", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("records clicks and aggregates counts per link / article / channel (as the app role)", async () => {
    const result = await withTenant(appDb, TENANT_A, async (tx) => {
      const article = await insertContentItem(tx, {
        tenantId: TENANT_A,
        type: "article",
        title: "Tracking",
        blocks: [],
      });
      const linkA = await insertAffiliateLink(tx, {
        tenantId: TENANT_A,
        code: "go-a",
        targetUrl: "https://example.com/a",
        contentItemId: article.id,
        channel: "blog",
      });
      const linkB = await insertAffiliateLink(tx, {
        tenantId: TENANT_A,
        code: "go-b",
        targetUrl: "https://example.com/b",
        channel: "blog",
      });
      // Resolve-by-code then record, exactly as the redirector does.
      const resolved = await getAffiliateLinkByCode(tx, "go-a");
      expect(resolved?.id).toBe(linkA.id);
      await recordClick(tx, resolved!);
      await recordClick(tx, resolved!);
      await recordClick(tx, linkB);

      const list = await listLinksWithClicks(tx);
      const byLink = await countClicksByLink(tx);
      const byArticle = await countClicksByArticle(tx);
      const byChannel = await countClicksByChannel(tx);
      return { article, linkA, linkB, list, byLink, byArticle, byChannel };
    });

    expect(result.list.find((l) => l.code === "go-a")!.clicks).toBe(2);
    expect(result.list.find((l) => l.code === "go-b")!.clicks).toBe(1);
    expect(result.byLink.find((l) => l.linkId === result.linkA.id)!.clicks).toBe(2);
    expect(result.byArticle.find((a) => a.contentItemId === result.article.id)!.clicks).toBe(2);
    expect(result.byChannel.find((c) => c.channel === "blog")!.clicks).toBe(3);
  });

  it("isolates links and clicks per tenant (RLS): B cannot resolve or count A's link", async () => {
    // Tenant B resolves A's code → null, sees no links, has empty counts.
    const seenByB = await withTenant(appDb, TENANT_B, async (tx) => ({
      resolved: await getAffiliateLinkByCode(tx, "go-a"),
      list: await listLinksWithClicks(tx),
      byLink: await countClicksByLink(tx),
      byChannel: await countClicksByChannel(tx),
    }));
    expect(seenByB.resolved).toBeNull();
    expect(seenByB.list).toHaveLength(0);
    expect(seenByB.byLink).toHaveLength(0);
    expect(seenByB.byChannel).toHaveLength(0);

    // Tenant A still sees its own two links.
    const seenByA = await withTenant(appDb, TENANT_A, (tx) => listLinksWithClicks(tx));
    expect(seenByA).toHaveLength(2);
  });

  it("the per-tenant unique code lets two tenants reuse the same code independently", async () => {
    // B can create its OWN 'go-a' (unique is per tenant), pointing elsewhere.
    const bLink = await withTenant(appDb, TENANT_B, (tx) =>
      insertAffiliateLink(tx, { tenantId: TENANT_B, code: "go-a", targetUrl: "https://b.example.com" }),
    );
    expect(bLink.code).toBe("go-a");
    // A re-creating its own 'go-a' is a duplicate within A.
    await expect(
      withTenant(appDb, TENANT_A, (tx) =>
        insertAffiliateLink(tx, { tenantId: TENANT_A, code: "go-a", targetUrl: "https://dup.example.com" }),
      ),
    ).rejects.toBeInstanceOf(DuplicateCodeError);
  });
});
