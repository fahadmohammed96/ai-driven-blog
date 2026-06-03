import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { createDb, type Db } from "../db/client";
import { HashingEmbedder } from "./embedder";
import { storeChunk, retrieveSimilar } from "./rag";
import { generateDraft, type BrandVoice } from "./pipeline";
import type { LlmPort, LlmRequest, LlmResponse } from "./llm";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle"); // src/platform/ai -> apps/api/drizzle

const TENANT = "11111111-1111-1111-1111-111111111111";

const CHUNKS = [
  "Giappone: guida al cibo, il miglior ramen e sushi a Tokyo.",
  "Portogallo: Lisbona, i tram gialli e i pasteis de nata.",
  "Italia: storia antica, Roma e il Colosseo.",
];

class FakeLlm implements LlmPort {
  public lastReq: LlmRequest | undefined;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.lastReq = req;
    const systemLen = req.system.map((b) => b.text).join(" ").length;
    const userText = req.messages.find((m) => m.role === "user")?.content ?? "";
    return {
      content: `BOZZA(${systemLen}): ${userText.slice(0, 40)}`,
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    };
  }
}

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: Db;
const embedder = new HashingEmbedder();

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  const created = createDb(container.getConnectionUri());
  db = created.db;
  pool = created.pool;

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await pool.query(readFileSync(join(migrationsDir, f), "utf8"));
  }

  await pool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A')`, [TENANT]);

  for (const chunk of CHUNKS) {
    await storeChunk(db, TENANT, chunk, await embedder.embed(chunk));
  }
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("RAG over pgvector", () => {
  it("retrieves the most relevant chunk for a brief", async () => {
    const q = await embedder.embed("un articolo sul cibo in Giappone");
    const top = await retrieveSimilar(db, TENANT, q, 1);
    expect(top[0]).toContain("ramen");
  });

  it("generates a draft using the brand voice and retrieved context", async () => {
    const llm = new FakeLlm();
    const voice: BrandVoice = { tone: "entusiasta", audience: "foodie" };

    const result = await generateDraft(
      { embedder, llm, retrieve: (t, qe, k) => retrieveSimilar(db, t, qe, k) },
      { tenantId: TENANT, brief: "Scrivi sul cibo in Giappone", voice, k: 1 },
    );

    expect(result.draft.length).toBeGreaterThan(0);
    expect(result.usedContext[0]).toContain("ramen");
    expect(result.system).toContain("entusiasta");
    expect(llm.lastReq?.messages.find((m) => m.role === "user")?.content).toContain(
      "ramen",
    );
  });
});
