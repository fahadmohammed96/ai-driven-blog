import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
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
import { contentItems, leads } from "../../platform/db/schema";
import { PostgresAgentProposalStore } from "../content";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { StubLlmAdapter } from "../../platform/ai/llm";
import { HashingEmbedder } from "../../platform/ai/embedder";
import { retrieveSimilar } from "../../platform/ai/rag";
import { getTenantSettings } from "../settings";
import { insertLead, listLeads, type LeadRow } from "./crm.repo";
import type { NotificationPort, ClientNotification } from "./notification.port";
import { InboundAgent } from "./agents/inbound-agent";

/**
 * Inbound Agent (Slice O2) as the least-privilege runtime role (`app_rw`, DEBT-005):
 * proves the agent reads `leads` TENANT-SCOPED (RLS, no cross-tenant leak), stages
 * a `lead_classification` proposal in `agent_proposals` (pending + listed), and —
 * the design crux — that approving it is ACKNOWLEDGE-ONLY / NO-SEND: NO
 * `NotificationPort.notify` is ever called (spy = 0), NO `lead` row is mutated, NO
 * `content_items` row is minted (the `content_draft` default is never reached),
 * only the status flips and `{id,status}` is returned.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let runStore: PostgresAgentRunStore;
let proposals: PostgresAgentProposalStore;
let leadAId: string;

/** A spy NotificationPort: proves the approve gate NEVER sends (count must stay 0). */
const notifySpy: { calls: ClientNotification[]; port: NotificationPort } = {
  calls: [],
  port: {
    notify: async (msg) => {
      notifySpy.calls.push(msg);
      return { ref: "spy", status: "sent" };
    },
  },
};

const embedder = new HashingEmbedder();

function makeAgent(): InboundAgent {
  return new InboundAgent({
    llm: new StubLlmAdapter(),
    accessors: {
      leads: (tenantId) => withTenant(appDb, tenantId, (tx) => listLeads(tx)),
      brandVoice: (tenantId) =>
        withTenant(appDb, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.brandVoice),
      rag: {
        embed: (text) => embedder.embed(text),
        retrieve: (tenantId, embedding, k) => retrieveSimilar(appDb, tenantId, embedding, k),
      },
    },
    store: runStore,
  });
}

async function countContentItems(tenantId: string): Promise<number> {
  return withTenant(appDb, tenantId, async (tx) => {
    const r = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${contentItems}`,
    );
    return Number(r.rows[0]!.n);
  });
}

async function getLeadRow(tenantId: string, id: string): Promise<LeadRow> {
  return withTenant(appDb, tenantId, async (tx) => {
    const rows = await tx.select().from(leads).where(eq(leads.id, id));
    return rows[0] as LeadRow;
  });
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

  // Provision + connect as the least-privilege runtime role (DEBT-005), so the
  // leads/agent_proposals grants are proven at runtime.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  runStore = new PostgresAgentRunStore(appDb);
  proposals = new PostgresAgentProposalStore(appDb);

  // Seed a lead for A only (to prove RLS isolation on read).
  const lead = await withTenant(appDb, TENANT_A, (tx) =>
    insertLead(tx, {
      tenantId: TENANT_A,
      customerEmail: "cliente@example.com",
      customerName: "Cliente A",
      channel: "email",
      request: "Vorrei organizzare un viaggio",
      portalToken: "tok-a",
    }),
  );
  leadAId = lead.id;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("Inbound Agent (Docker, as app_rw)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("reads leads TENANT-SCOPED — no cross-tenant leak", async () => {
    const leadsA = await withTenant(appDb, TENANT_A, (tx) => listLeads(tx));
    const leadsB = await withTenant(appDb, TENANT_B, (tx) => listLeads(tx));
    expect(leadsA.some((l) => l.id === leadAId)).toBe(true);
    expect(leadsB.some((l) => l.id === leadAId)).toBe(false);
  });

  it("stages a lead_classification proposal (pending) that appears in listPending", async () => {
    const proposal = await makeAgent().run(
      { message: "Vorrei un preventivo per un viaggio in Giappone" },
      { tenantId: TENANT_A },
    );
    expect(proposal.type).toBe("lead_classification");
    expect(proposal.status).toBe("pending");
    expect(proposal.payload.classification).toBe("lead");
    await proposals.persist(proposal);

    const pendingA = await proposals.listPending(TENANT_A);
    expect(pendingA.some((p) => p.id === proposal.id && p.type === "lead_classification")).toBe(true);
    // RLS: the other tenant never sees A's staged proposal.
    const pendingB = await proposals.listPending(TENANT_B);
    expect(pendingB.some((p) => p.id === proposal.id)).toBe(false);
  });

  it("approve is ACKNOWLEDGE-ONLY / NO-SEND: notify spy=0, no lead mutated, no content_item, returns {id,status}", async () => {
    notifySpy.calls = [];
    const proposal = await makeAgent().run(
      { message: "Aggiornamento sul mio viaggio", leadId: leadAId },
      { tenantId: TENANT_A },
    );
    await proposals.persist(proposal);

    const itemsBefore = await countContentItems(TENANT_A);
    const leadBefore = await getLeadRow(TENANT_A, leadAId);

    const returned = await proposals.approve(TENANT_A, proposal.id);

    const itemsAfter = await countContentItems(TENANT_A);
    const leadAfter = await getLeadRow(TENANT_A, leadAId);

    // NO-SEND: the gate never routed a notification.
    expect(notifySpy.calls).toHaveLength(0);
    // The content_draft DEFAULT branch was NOT reached (no item created).
    expect(itemsAfter).toBe(itemsBefore);
    // No lead was mutated (status + updatedAt unchanged).
    expect(leadAfter.status).toBe(leadBefore.status);
    expect(leadAfter.updatedAt.getTime()).toBe(leadBefore.updatedAt.getTime());
    // Acknowledge-only result shape: just the id + the new status.
    expect(returned).toEqual({ id: proposal.id, status: "approved" });
    // The proposal is no longer pending.
    const pending = await proposals.listPending(TENANT_A);
    expect(pending.some((p) => p.id === proposal.id)).toBe(false);
  });

  it("IDEMPOTENT staging: re-running + re-persisting the same input dedupes (stable id)", async () => {
    const triggeredAt = new Date("2026-06-02T09:00:00.000Z");
    const p1 = await makeAgent().run({ message: "Vorrei prenotare" }, { tenantId: TENANT_A, triggeredAt });
    const p2 = await makeAgent().run({ message: "Vorrei prenotare" }, { tenantId: TENANT_A, triggeredAt });
    expect(p2.id).toBe(p1.id);
    await proposals.persist(p1);
    await proposals.persist(p2); // onConflictDoNothing(id) → no duplicate

    const pending = await proposals.listPending(TENANT_A);
    expect(pending.filter((p) => p.id === p1.id)).toHaveLength(1);
  });
});
