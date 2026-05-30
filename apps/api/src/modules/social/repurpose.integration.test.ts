import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { Block } from "@blogs/contracts";
import { channelPostSchema } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { insertContentItem, ContentNotFoundError } from "../content";
import { repurposeArticle, getChannelPosts, NotAnArticleError } from "./distribution";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

const ARTICLE_BLOCKS: Block[] = [
  { type: "heading", level: 1, text: "Una settimana in Giappone" },
  { type: "heading", level: 2, text: "Tokyo" },
  { type: "paragraph", text: "Ho camminato tra i vicoli di Shibuya al tramonto, perdendomi nel ritmo della città." },
  { type: "image", assetId: ASSET, alt: "Tokyo" },
];

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;

async function newArticle(tenantId: string, type: "article" | "itinerary" = "article"): Promise<string> {
  const row = await withTenant(db, tenantId, (tx) =>
    insertContentItem(tx, { tenantId, type, title: "Una settimana in Giappone", blocks: ARTICLE_BLOCKS }),
  );
  return row.id;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));

  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, channel_posts TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A'), ($2,'tenant-b','Tenant B')`,
    [TENANT_A, TENANT_B],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("repurpose article → channel posts (persisted)", () => {
  it("generates one persisted, valid post per requested channel", async () => {
    const id = await newArticle(TENANT_A);
    const rows = await repurposeArticle(db, TENANT_A, id, ["instagram", "x", "pinterest"]);

    expect(rows.map((r) => r.channel).sort()).toEqual(["instagram", "pinterest", "x"]);
    for (const r of rows) expect(channelPostSchema.safeParse(r.payload).success).toBe(true);

    const persisted = await getChannelPosts(db, TENANT_A, id);
    expect(persisted).toHaveLength(3);

    const pin = rows.find((r) => r.channel === "pinterest")!;
    expect(pin.payload).toMatchObject({ channel: "pinterest", imageAssetId: ASSET });
  });

  it("hides another tenant's article (RLS) → ContentNotFoundError", async () => {
    const id = await newArticle(TENANT_A);
    await expect(repurposeArticle(db, TENANT_B, id, ["x"])).rejects.toBeInstanceOf(
      ContentNotFoundError,
    );
  });

  it("refuses to repurpose a non-article content item", async () => {
    const id = await newArticle(TENANT_A, "itinerary");
    await expect(repurposeArticle(db, TENANT_A, id, ["x"])).rejects.toBeInstanceOf(
      NotAnArticleError,
    );
  });
});
