import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Phase 3 — Slice 1: the Affiliate hub + /go redirector + click tracking.
// ROADMAP acceptance: "a click passes through the redirector and is counted per
// link / article / channel." This journey creates a tracked link IN THE SURFACE,
// exercises the redirector (GET /go/:code → 302 to the target), and asserts the
// click count increments on the surface.
//
// Links accumulate in the shared dev DB across runs, so every assertion is scoped
// to THIS run's unique code — never to the total list length.

test.describe("affiliate hub", () => {
  test("create a link, click through /go/:code, and see the count increment", async ({
    page,
    request,
  }) => {
    const code = `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const target = "https://partner.example.com/landing?ref=blogs";

    // 1) Create the tracked link in the Affiliate surface.
    await page.goto("/affiliates");
    await expect(page.getByTestId("surface-affiliates")).toBeVisible();
    await expect(page.getByTestId("affiliates-header")).toBeVisible();

    await page.getByTestId("affiliate-code").fill(code);
    await page.getByTestId("affiliate-target").fill(target);
    await page.getByTestId("affiliate-channel").fill("blog");
    await page.getByTestId("affiliate-create-submit").click();

    // The new link shows in the list with zero clicks.
    const item = page.getByTestId("affiliate-item").filter({ hasText: `/go/${code}` });
    await expect(item).toBeVisible();
    await expect(item.getByTestId("affiliate-clicks")).toContainText("0");

    // 2) Exercise the redirector: it 302-redirects to the target (don't follow).
    const redirect = await request.get(`${API}/go/${code}`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()["location"]).toBe(target);

    // 3) The click was counted: reload the surface and assert it incremented.
    await page.goto("/affiliates");
    const reloaded = page.getByTestId("affiliate-item").filter({ hasText: `/go/${code}` });
    await expect(reloaded.getByTestId("affiliate-clicks")).toContainText("1");

    // And the aggregated stats endpoint counts it per channel too.
    const stats = await (await request.get(`${API}/affiliates/stats`)).json();
    const channelRow = (stats.byChannel as { channel: string; clicks: number }[]).find(
      (c) => c.channel === "blog",
    );
    expect(channelRow).toBeTruthy();
    expect(channelRow!.clicks).toBeGreaterThanOrEqual(1);
  });

  test("an unknown code 404s at the redirector", async ({ request }) => {
    const res = await request.get(`${API}/go/does-not-exist-${Date.now()}`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});
