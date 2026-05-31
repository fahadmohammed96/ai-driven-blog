import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Phase 4 — Slice 2: the feedback loop. ROADMAP acceptance: "given certain metric
// results, the AI proposals change accordingly." This journey SELF-SEEDS a real
// internal signal (an affiliate click through /go on a unique channel), runs the
// cross-channel ingest on the Analytics surface, then asserts the "next cycle"
// proposal card adapts to favour the channel that performed.
//
// Metrics accumulate in the shared dev DB across runs, so the assertion is scoped
// to THIS run's unique, high-engagement channel — which dominates the proposal.

test.describe("feedback loop — metrics adapt the next AI proposal", () => {
  test("a click on a unique channel makes that channel the proposal's primary", async ({
    page,
    request,
  }) => {
    const channel = `e2e-fb-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const code = `fb-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    // 1) Self-seed a REAL internal signal: an affiliate link on a unique channel,
    //    then several clicks through the redirector so it leads the engagement.
    const created = await request.post(`${API}/affiliates`, {
      data: { code, targetUrl: "https://partner.example.com/landing", channel },
    });
    expect(created.ok()).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      const redirect = await request.get(`${API}/go/${code}`, { maxRedirects: 0 });
      expect(redirect.status()).toBe(302);
    }

    // 2) Open Analytics and run the cross-channel ingest (snapshots the clicks).
    await page.goto("/analytics");
    await expect(page.getByTestId("surface-analytics")).toBeVisible();
    await page.getByTestId("analytics-refresh").click();

    // 3) The feedback proposal card adapts: this run's channel is the primary,
    //    with a rationale citing the metric signal — the loop changed WHAT is
    //    proposed (the human still confirms; the approval gate is untouched).
    const card = page.getByTestId("feedback-proposal");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("feedback-primary-channel")).toHaveText(channel);
    await expect(page.getByTestId("feedback-rationale")).toContainText(channel);

    const emphasis = page.locator(
      `[data-testid="feedback-emphasis"][data-channel="${channel}"]`,
    );
    await expect(emphasis).toHaveAttribute("data-weight", "primary");
  });
});
