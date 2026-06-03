import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Phase 4 — Slice 2: the feedback loop. ROADMAP acceptance: "given certain metric
// results, the AI proposals change accordingly." This journey proves that as a
// BEFORE/AFTER change: the proposal does NOT mention a brand-new channel, then a
// real internal signal (affiliate clicks through /go on a unique channel) is
// ingested and the proposal demonstrably CHANGES to fold that channel into its
// ranked plan.
//
// Realism note: in the full system the cross-channel mix includes the stubbed
// GA4 + Search Console baseline (organic ~21k engagement: sessions+users+clicks+
// impressions). A handful of fresh clicks correctly does NOT — and should not —
// dethrone that baseline as the PRIMARY channel; the loop ranking it below
// organic is the correct behaviour. So the strong, deterministic assertion is
// that the new metric enters the proposal (the loop reacts), not that one click
// outranks thousands of organic sessions. The channel is unique per run, so the
// "absent before" / "present after" transition is deterministic.

test.describe("feedback loop — metrics adapt the next AI proposal", () => {
  test("a fresh real signal enters the proposal's ranked plan (before → after)", async ({
    page,
    request,
  }) => {
    const channel = `e2e-fb-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const code = `fb-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const emphasisRow = page.locator(
      `[data-testid="feedback-emphasis"][data-channel="${channel}"]`,
    );

    // 1) Open Analytics and run a baseline ingest. The proposal card renders, and
    //    our brand-new unique channel is NOT yet part of any proposal.
    await page.goto("/analytics");
    await expect(page.getByTestId("surface-analytics")).toBeVisible();
    await page.getByTestId("analytics-refresh").click();
    await expect(page.getByTestId("feedback-proposal")).toBeVisible();
    await expect(emphasisRow).toHaveCount(0);

    // 2) Self-seed a REAL internal signal: an affiliate link on the unique channel,
    //    then several clicks through the redirector (snapshotted at ingest time).
    const created = await request.post(`${API}/affiliates`, {
      data: { code, targetUrl: "https://partner.example.com/landing", channel },
    });
    expect(created.ok()).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      const redirect = await request.get(`${API}/go/${code}`, { maxRedirects: 0 });
      expect(redirect.status()).toBe(302);
    }

    // 3) Re-ingest: the metrics changed, so the proposal must change accordingly.
    await page.getByTestId("analytics-refresh").click();

    // 4) The loop reacted: the unique channel is now in the proposal's ranked plan
    //    (weighted by its real engagement). The loop changed WHAT is proposed; the
    //    human still confirms — the approval gate is untouched (ADR-0020).
    await expect(emphasisRow).toHaveCount(1);
    await expect(emphasisRow).toContainText(channel);
    // The proposal stays meaningful (a primary channel is recommended).
    await expect(page.getByTestId("feedback-primary-channel")).toBeVisible();
  });
});
