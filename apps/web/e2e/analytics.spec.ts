import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Phase 4 — Slice 1: unified analytics. ROADMAP acceptance: "one dashboard shows
// cross-channel metrics." This journey SELF-SEEDS a real internal signal (an
// affiliate click through the /go redirector), then opens the Analytics surface,
// runs the cross-channel ingest, and asserts the dashboard shows BOTH the real
// internal metric AND the stubbed external sources (GA4 / Search Console),
// clearly labelled as stubs.
//
// Metrics accumulate in the shared dev DB across runs, so the real-data assertion
// is scoped to THIS run's unique channel — never to a total.

test.describe("unified analytics dashboard", () => {
  test("ingests cross-channel metrics: real affiliate click + stubbed GA4/Search Console", async ({
    page,
    request,
  }) => {
    const channel = `e2e-an-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const code = `an-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    // 1) Self-seed a REAL internal signal: a tracked affiliate link on a unique
    //    channel, then a click through the redirector (counted at ingest time).
    const created = await request.post(`${API}/affiliates`, {
      data: { code, targetUrl: "https://partner.example.com/landing", channel },
    });
    expect(created.ok()).toBeTruthy();
    const redirect = await request.get(`${API}/go/${code}`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);

    // 2) Open the Analytics surface and run the cross-channel ingest.
    await page.goto("/analytics");
    await expect(page.getByTestId("surface-analytics")).toBeVisible();
    await expect(page.getByTestId("analytics-header")).toBeVisible();
    await page.getByTestId("analytics-refresh").click();

    // 3) REAL internal: the seeded affiliate click shows on its unique channel.
    //    data-* attributes live on the row (<tr data-testid="analytics-metric-row">).
    const realRow = page.locator(
      `[data-testid="analytics-metric-row"][data-source="affiliate"][data-channel="${channel}"]`,
    );
    await expect(realRow).toBeVisible();
    await expect(realRow).toContainText("1");

    // 4) STUBBED external, clearly labelled: GA4 + Search Console source cards
    //    carry the "stub" badge, and GA4 organic sessions render.
    await expect(page.getByTestId("analytics-source-ga4")).toBeVisible();
    await expect(page.getByTestId("analytics-kind-ga4")).toHaveText(/stub/i);
    await expect(page.getByTestId("analytics-source-search_console")).toBeVisible();
    await expect(page.getByTestId("analytics-kind-search_console")).toHaveText(/stub/i);

    const ga4Sessions = page.locator(
      `[data-testid="analytics-metric-row"][data-source="ga4"][data-channel="organic"][data-metric="sessions"]`,
    );
    await expect(ga4Sessions).toContainText("1240");

    // 5) CROSS-CHANNEL: at least the seeded internal source + a stubbed external
    //    source both appear in the per-source rollup — one unified dashboard.
    await expect(page.getByTestId("analytics-source-affiliate")).toBeVisible();
    await expect(page.getByTestId("analytics-kind-affiliate")).toHaveText(/reale/i);
  });
});
