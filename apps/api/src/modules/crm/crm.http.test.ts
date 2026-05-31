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
import type { LeadView, PortalView } from "@blogs/contracts";
import { DB, LLM, NOTIFICATION, PAYMENT } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { StubLlmClient } from "../../platform/ai/llm";
import { TenancyService } from "../tenancy";
import { StubPaymentClient } from "../commerce";
import { CrmController } from "./crm.controller";
import { StubNotificationClient } from "./notification.stub";
import { insertLead } from "./crm.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;
let notification: StubNotificationClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, leads, tenant_settings TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder'), ($2,'other','Other')`,
    [TENANT, OTHER],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  notification = new StubNotificationClient();
  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      TenancyService,
      { provide: DB, useValue: db },
      { provide: LLM, useValue: new StubLlmClient() },
      { provide: PAYMENT, useValue: new StubPaymentClient() },
      { provide: NOTIFICATION, useValue: notification },
    ],
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

describe("crm: inbound custom-trip pipeline (request → AI proposal → approve → deposit → confirm → deliver)", () => {
  it("travels the whole pipeline, enforcing the human gate (nothing sent before approval)", async () => {
    const server = app.getHttpServer();
    const before = notification.sent.length;

    // 1) An inbound request enters → received, with a portal token, no proposal.
    const leadRes = await request(server)
      .post("/leads")
      .send({ customerEmail: "ada@example.com", customerName: "Ada", request: "Giappone in autunno, 2 settimane" })
      .expect(201);
    const lead = leadRes.body as LeadView;
    expect(lead.status).toBe("received");
    expect(lead.channel).toBe("email");
    expect(lead.proposal).toBeNull();
    expect(lead.portalToken).toBeTruthy();

    // The client portal reveals nothing yet (gate, read half).
    const portal0 = (await request(server).get(`/portal/${lead.portalToken}`).expect(200)).body as PortalView;
    expect(portal0.status).toBe("received");
    expect(portal0.itinerary).toBeNull();

    // 2) The AI drafts the proposal → ai_drafted. Stored but NOT sent.
    const draftRes = await request(server)
      .post(`/leads/${lead.id}/draft`)
      .send({ depositCents: 30_000 })
      .expect(200);
    const drafted = draftRes.body as LeadView;
    expect(drafted.status).toBe("ai_drafted");
    expect(drafted.proposal).toBeTruthy();
    expect(drafted.depositCents).toBe(30_000);
    expect(drafted.currency).toBe("eur");

    // THE GATE: drafting must NOT route anything to the client.
    expect(notification.sent.length).toBe(before);

    // 3) A human approves → the proposal is routed, then the lead is sent.
    const approveRes = await request(server).post(`/leads/${lead.id}/approve`).expect(200);
    const approved = approveRes.body as LeadView;
    expect(approved.status).toBe("sent");
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.sentAt).not.toBeNull();

    // Exactly one proposal notification was routed, only after approval.
    const afterApprove = notification.sent.filter((n) => n.leadId === lead.id);
    expect(afterApprove).toHaveLength(1);
    expect(afterApprove[0]!.kind).toBe("proposal");
    expect(afterApprove[0]!.to).toBe("ada@example.com");

    // 4) The deposit is collected through the PaymentPort → confirmed.
    const depositRes = await request(server).post(`/leads/${lead.id}/deposit`).expect(200);
    const confirmed = depositRes.body as LeadView;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.paymentRef).toBe(`pi_stub_${lead.id}`);
    expect(confirmed.confirmedAt).not.toBeNull();

    // 5) The confirmed itinerary is delivered → delivered + itinerary notification.
    const deliverRes = await request(server).post(`/leads/${lead.id}/deliver`).expect(200);
    const delivered = deliverRes.body as LeadView;
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();

    const kinds = notification.sent.filter((n) => n.leadId === lead.id).map((n) => n.kind);
    expect(kinds).toEqual(["proposal", "itinerary"]);

    // 6) The portal now delivers the itinerary to the client.
    const portal1 = (await request(server).get(`/portal/${lead.portalToken}`).expect(200)).body as PortalView;
    expect(portal1.status).toBe("delivered");
    expect(portal1.itinerary).toBe(delivered.proposal);
    expect(portal1.customerName).toBe("Ada");

    // Idempotent: once delivered, re-paying and re-delivering return the lead
    // unchanged (still delivered, already past payment) and don't double-route.
    const sentCount = notification.sent.filter((n) => n.leadId === lead.id).length;
    expect((await request(server).post(`/leads/${lead.id}/deposit`).expect(200)).body.status).toBe("delivered");
    expect((await request(server).post(`/leads/${lead.id}/deliver`).expect(200)).body.status).toBe("delivered");
    expect(notification.sent.filter((n) => n.leadId === lead.id).length).toBe(sentCount);
  });

  it("blocks out-of-order moves: a received lead cannot be approved or paid (409)", async () => {
    const server = app.getHttpServer();
    const lead = (
      await request(server)
        .post("/leads")
        .send({ customerEmail: "bob@example.com", request: "Islanda" })
        .expect(201)
    ).body as LeadView;
    const sentBefore = notification.sent.length;

    await request(server).post(`/leads/${lead.id}/approve`).expect(409);
    await request(server).post(`/leads/${lead.id}/deposit`).expect(409);
    await request(server).post(`/leads/${lead.id}/deliver`).expect(409);
    // None of the blocked moves routed anything.
    expect(notification.sent.length).toBe(sentBefore);
  });

  it("reject loops a draft back to received for a re-draft (no routing)", async () => {
    const server = app.getHttpServer();
    const lead = (
      await request(server)
        .post("/leads")
        .send({ customerEmail: "cleo@example.com", request: "Marocco" })
        .expect(201)
    ).body as LeadView;
    await request(server).post(`/leads/${lead.id}/draft`).send({ depositCents: 20_000 }).expect(200);
    const sentBefore = notification.sent.length;

    const rejected = (await request(server).post(`/leads/${lead.id}/reject`).expect(200)).body as LeadView;
    expect(rejected.status).toBe("received");
    expect(notification.sent.length).toBe(sentBefore);

    // Re-draftable after a reject.
    const redrafted = (
      await request(server).post(`/leads/${lead.id}/draft`).send({ depositCents: 25_000 }).expect(200)
    ).body as LeadView;
    expect(redrafted.status).toBe("ai_drafted");
    expect(redrafted.depositCents).toBe(25_000);
  });

  it("404s unknown leads, drafts and portal tokens; 400s an invalid lead body", async () => {
    const server = app.getHttpServer();
    const missing = "66666666-6666-6666-6666-666666666666";
    await request(server).get(`/leads/${missing}`).expect(404);
    await request(server).post(`/leads/${missing}/draft`).send({ depositCents: 100 }).expect(404);
    await request(server).post(`/leads/${missing}/approve`).expect(404);
    await request(server).get(`/portal/does-not-exist`).expect(404);
    await request(server).post("/leads").send({ customerEmail: "nope", request: "" }).expect(400);
  });

  it("RLS: the founder cannot see or open another tenant's lead/portal", async () => {
    const server = app.getHttpServer();
    // Seed a lead directly under OTHER's tenant context.
    const otherLead = await withTenant(db, OTHER, (tx) =>
      insertLead(tx, {
        tenantId: OTHER,
        customerEmail: "secret@other.com",
        channel: "email",
        request: "Secret trip",
        portalToken: "other-secret-token",
      }),
    );

    // The founder never lists OTHER's lead…
    const list = (await request(server).get("/leads").expect(200)).body as { leads: LeadView[] };
    expect(list.leads.some((l) => l.id === otherLead.id)).toBe(false);
    // …and cannot read it by id (RLS → 404).
    await request(server).get(`/leads/${otherLead.id}`).expect(404);

    // The portal token resolves in the founder context, so OTHER's token is unseen.
    await request(server).get(`/portal/other-secret-token`).expect(404);
  });
});
