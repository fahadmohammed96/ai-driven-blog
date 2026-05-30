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
import { AppModule } from "./app.module";
import { DB, STORAGE, LLM } from "./platform/tokens";
import { createDb } from "./platform/db/client";
import { StubLlmClient } from "./platform/ai/llm";
import type { StoragePort } from "./modules/media";
import { makeJpegWithExif } from "./modules/media/photo.fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../drizzle");
const TENANT = "00000000-0000-0000-0000-000000000000";

class InMemoryStorage implements StoragePort {
  private readonly store = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<void> {
    this.store.set(key, body);
  }
  async get(key: string): Promise<Buffer> {
    const b = this.store.get(key);
    if (!b) throw new Error(`no object: ${key}`);
    return b;
  }
  async presignGet(key: string): Promise<string> {
    return `memory://${key}`;
  }
}

let container: StartedPostgreSqlContainer;
let pool: Pool;
let appPool: Pool;
let app: INestApplication;

beforeAll(async () => {
  process.env.FOUNDER_TENANT_ID = TENANT;

  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await pool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await pool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder')`, [TENANT]);

  const created = createDb(container.getConnectionUri());
  appPool = created.pool;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB)
    .useValue(created.db)
    .overrideProvider(STORAGE)
    .useValue(new InMemoryStorage())
    .overrideProvider(LLM)
    .useValue(new StubLlmClient())
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await pool?.end();
  await container?.stop();
});

const itinerary = {
  title: "Giappone in primavera",
  stops: [
    { place: "Tokyo", geo: { lat: 35.68, lng: 139.69 }, startDate: "2026-04-01", endDate: "2026-04-04", notes: "Shibuya" },
    { place: "Kyoto", geo: { lat: 35.01, lng: 135.77 }, startDate: "2026-04-05", endDate: "2026-04-07", notes: "templi" },
  ],
};

describe("journey HTTP: itinerary + photo → published article", () => {
  it("runs the full flow", async () => {
    const server = app.getHttpServer();

    // 1) create itinerary
    const created = await request(server).post("/itineraries").send(itinerary).expect(201);
    const itineraryId: string = created.body.id;
    expect(itineraryId).toBeTruthy();

    // 2) upload a photo (06-Apr, near Kyoto) → auto-organized
    const photo = await makeJpegWithExif({ takenOn: "2026-04-06", geo: { lat: 35.02, lng: 135.78 } });
    const uploaded = await request(server)
      .post(`/itineraries/${itineraryId}/photos`)
      .attach("file", photo, { filename: "kyoto.jpg", contentType: "image/jpeg" })
      .expect(201);
    expect(uploaded.body.assetId).toBeTruthy();
    expect(uploaded.body.stopId).toBeTruthy();

    // 3) generate the article draft (photo embedded)
    const generated = await request(server)
      .post(`/itineraries/${itineraryId}/article`)
      .send({ userNotes: "viaggio indimenticabile" })
      .expect(201);
    const articleId: string = generated.body.articleId;
    expect(articleId).toBeTruthy();
    expect(generated.body.blocks.some((b: { type: string }) => b.type === "image")).toBe(true);
    expect(generated.body.authenticity).toHaveProperty("score");

    // 4) publish (walks the lifecycle to published)
    const published = await request(server).post(`/articles/${articleId}/publish`).expect(200);
    expect(published.body.status).toBe("published");
    expect(published.body.publishedAt).toBeTruthy();

    // 5) read it back as published
    const fetched = await request(server).get(`/articles/${articleId}`).expect(200);
    expect(fetched.body.status).toBe("published");
    expect(fetched.body.blocks.length).toBeGreaterThan(0);
  });

  it("rejects an invalid itinerary and a publish of a missing article", async () => {
    const server = app.getHttpServer();
    await request(server).post("/itineraries").send({ title: "", stops: [] }).expect(400);
    await request(server)
      .post("/articles/99999999-9999-9999-9999-999999999999/publish")
      .expect(404);
  });
});
