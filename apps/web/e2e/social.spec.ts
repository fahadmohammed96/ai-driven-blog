import { test, expect, request as pwRequest } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Seed an article through the real pipeline (itinerary -> generated article).
async function seedArticle(): Promise<{ id: string }> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const itinRes = await ctx.post("/itineraries", {
    data: {
      title: uniqueTitle("Social Trip"),
      stops: [
        { place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04" },
        { place: "Kyoto", startDate: "2026-04-05", endDate: "2026-04-07" },
      ],
    },
  });
  if (!itinRes.ok()) throw new Error(`itinerary seed failed: ${itinRes.status()}`);
  const itineraryId = (await itinRes.json()).id as string;

  const artRes = await ctx.post(`/itineraries/${itineraryId}/article`, { data: {} });
  if (!artRes.ok()) throw new Error(`article generation failed: ${artRes.status()}`);
  const articleId = (await artRes.json()).articleId as string;

  await ctx.dispose();
  return { id: articleId };
}

// Slice A3 — the Hub's distribution control: turn an article into per-channel
// posts and apply the human gate (approve) before anything goes out.
test("generate and approve social posts for an article from the hub", async ({ page }) => {
  const { id } = await seedArticle();

  await page.goto("/social");
  await expect(page.getByTestId("surface-social")).toBeVisible();

  const row = page.locator(`[data-testid="social-item"][data-article-id="${id}"]`);
  await expect(row).toBeVisible();

  await row.getByTestId("social-generate").click();

  // The Instagram post appears in draft; the human gate approves it.
  const ig = row.locator(`[data-testid="social-post"][data-channel="instagram"]`);
  await expect(ig).toBeVisible();
  await expect(ig).toHaveAttribute("data-status", "draft");

  await ig.getByTestId("social-approve").click();
  await expect(ig).toHaveAttribute("data-status", "approved");
});
