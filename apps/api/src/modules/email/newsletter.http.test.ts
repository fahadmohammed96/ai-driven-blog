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
import { DB, EMAIL } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import type { EmailMessage, EmailPort } from "./email.port";
import { NewsletterController } from "./newsletter.controller";
import { findSubscriberByEmail } from "./subscribers.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "77777777-7777-7777-7777-777777777777";

class CapturingEmail implements EmailPort {
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;
const email = new CapturingEmail();

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, subscribers, subscriptions TO appuser`,
  );
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder')`, [TENANT]);
  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [NewsletterController],
    providers: [TenancyService, { provide: DB, useValue: db }, { provide: EMAIL, useValue: email }],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("newsletter HTTP", () => {
  it("drives subscribe → confirm → segmented send", async () => {
    const server = app.getHttpServer();

    await request(server)
      .post("/newsletter/subscribe")
      .send({ email: "ada@test.dev", themes: ["party"] })
      .expect(202);
    expect(email.sent.at(-1)?.to).toBe("ada@test.dev");

    const sub = await withTenant(db, TENANT, (tx) => findSubscriberByEmail(tx, "ada@test.dev"));
    const confirmed = await request(server)
      .get("/newsletter/confirm")
      .query({ token: sub!.confirmToken })
      .expect(200);
    expect(confirmed.body.status).toBe("confirmed");

    const sent = await request(server)
      .post("/newsletter/send")
      .send({ theme: "party", subject: "Ciao", html: "<p>hi</p>" })
      .expect(200);
    expect(sent.body.recipients).toEqual(["ada@test.dev"]);
    expect(sent.body.sent).toBe(1);
  });

  it("rejects an invalid email (400) and an unknown confirm token (400)", async () => {
    const server = app.getHttpServer();
    await request(server)
      .post("/newsletter/subscribe")
      .send({ email: "not-an-email", themes: ["party"] })
      .expect(400);
    await request(server).get("/newsletter/confirm").query({ token: "bogus" }).expect(400);
  });
});
