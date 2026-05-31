import { test, expect } from "@playwright/test";

// Phase 3 — Slice 3: the inbound custom-trip CRM pipeline (motion "Su misura").
// ROADMAP acceptance: "a lead travels the pipeline (request → AI proposal →
// deposit → confirm) and the itinerary is delivered to the client portal." The
// human-in-the-loop gate is enforced: nothing reaches the client before approval.
//
// The lead is created and driven THROUGH the /crm surface; the itinerary delivery
// is verified via the public client portal (`/portal/:token`). Rows accumulate in
// the shared dev DB across runs, so assertions are scoped to THIS run's lead.

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

test.describe("crm (custom-trip pipeline — Su misura)", () => {
  test("request → AI draft → approve (gate) → deposit → confirm → deliver to portal", async ({
    page,
    request,
  }) => {
    const email = `e2e-lead-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;

    // 1) Open a custom-trip request through the CRM surface.
    await page.goto("/crm");
    await expect(page.getByTestId("surface-crm")).toBeVisible();
    await page.getByTestId("lead-email").fill(email);
    await page.getByTestId("lead-request").fill("Giappone in autunno, due settimane, ritmo lento");
    await page.getByTestId("lead-create").click();

    const lead = page.getByTestId("lead-item").filter({ hasText: email });
    await expect(lead).toBeVisible();
    await expect(lead.getByTestId("lead-status")).toHaveAttribute("data-status", "received");

    // 2) The AI drafts the proposal (with the offered deposit) → ai_drafted.
    await lead.getByTestId("draft-deposit").fill("30000");
    await lead.getByTestId("draft-submit").click();
    await expect(lead.getByTestId("lead-status")).toHaveAttribute("data-status", "ai_drafted");
    await expect(lead.getByTestId("lead-proposal")).toBeVisible();

    // 3) The human approves → the proposal is routed and the lead is sent.
    await lead.getByTestId("approve-submit").click();
    await expect(lead.getByTestId("lead-status")).toHaveAttribute("data-status", "sent");

    // 4) Collect the deposit (stub) → confirmed, with a deterministic payment ref.
    await lead.getByTestId("deposit-submit").click();
    await expect(lead.getByTestId("lead-status")).toHaveAttribute("data-status", "confirmed");
    await expect(lead.getByTestId("payment-ref")).toContainText("pi_stub_");

    // 5) Deliver the itinerary → delivered, with a client-portal link.
    await lead.getByTestId("deliver-submit").click();
    await expect(lead.getByTestId("lead-status")).toHaveAttribute("data-status", "delivered");
    const portal = lead.getByTestId("portal-link");
    await expect(portal).toBeVisible();
    const token = await portal.getAttribute("data-token");
    expect(token).toBeTruthy();

    // 6) The public client portal now delivers the itinerary to the client.
    const portalRes = await request.get(`${API}/portal/${token}`);
    expect(portalRes.ok()).toBeTruthy();
    const portalView = await portalRes.json();
    expect(portalView.status).toBe("delivered");
    expect(portalView.itinerary).toBeTruthy();
  });
});
