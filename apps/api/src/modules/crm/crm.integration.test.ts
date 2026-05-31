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
import { StubLlmClient } from "../../platform/ai/llm";
import { StubPaymentClient } from "../commerce";
import { StubNotificationClient } from "./notification.stub";
import {
  approveAndSend,
  createLead,
  type CrmDeps,
  deliverItinerary,
  draftLeadProposal,
  payLeadDeposit,
} from "./crm.service";
import { getLead, listLeads } from "./crm.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let deps: CrmDeps;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Connect as the real least-privilege runtime role (DEBT-005): proves the grants
  // the CRM pipeline needs at runtime + that RLS is enforced.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  deps = {
    db: appDb,
    llm: new StubLlmClient(),
    payment: new StubPaymentClient(),
    notification: new StubNotificationClient(),
  };
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("crm custom-trip pipeline — runtime RLS via the app role", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("drafts → approves → deposits → delivers, enforcing the human gate", async () => {
    const notification = deps.notification as StubNotificationClient;
    const lead = await createLead(deps, {
      tenantId: TENANT_A,
      customerEmail: "ada@a.com",
      channel: "email",
      request: "Patagonia, 10 giorni",
    });
    expect(lead.status).toBe("received");

    const drafted = await draftLeadProposal(deps, {
      tenantId: TENANT_A,
      leadId: lead.id,
      depositCents: 40_000,
      currency: "eur",
    });
    expect(drafted.status).toBe("ai_drafted");
    expect(drafted.proposal).toBeTruthy();
    // THE GATE: drafting routes nothing to the client.
    expect(notification.sent.filter((n) => n.leadId === lead.id)).toHaveLength(0);

    const sent = await approveAndSend(deps, { tenantId: TENANT_A, leadId: lead.id });
    expect(sent.status).toBe("sent");
    expect(notification.sent.filter((n) => n.leadId === lead.id && n.kind === "proposal")).toHaveLength(1);

    const confirmed = await payLeadDeposit(deps, { tenantId: TENANT_A, leadId: lead.id });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.paymentRef).toBe(`pi_stub_${lead.id}`);

    const delivered = await deliverItinerary(deps, { tenantId: TENANT_A, leadId: lead.id });
    expect(delivered.status).toBe("delivered");
    expect(notification.sent.filter((n) => n.leadId === lead.id && n.kind === "itinerary")).toHaveLength(1);

    // Visible to A.
    const reread = await withTenant(appDb, TENANT_A, (tx) => getLead(tx, lead.id));
    expect(reread?.status).toBe("delivered");
  });

  it("isolates leads per tenant (RLS): B sees none of A's, and cannot drive A's lead", async () => {
    const aLead = await createLead(deps, {
      tenantId: TENANT_A,
      customerEmail: "iso@a.com",
      channel: "email",
      request: "A-only trip",
    });

    const seenByB = await withTenant(appDb, TENANT_B, (tx) => listLeads(tx));
    expect(seenByB.some((l) => l.id === aLead.id)).toBe(false);

    // B drafting against A's lead id fails (the lead is invisible → not found).
    await expect(
      draftLeadProposal(deps, { tenantId: TENANT_B, leadId: aLead.id, depositCents: 10_000, currency: "eur" }),
    ).rejects.toThrow();

    // B cannot read A's lead row.
    const bView = await withTenant(appDb, TENANT_B, (tx) => getLead(tx, aLead.id));
    expect(bView).toBeNull();
  });
});
