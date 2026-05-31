import { test, expect, request as pwRequest } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Unique titles so assertions survive a shared dev DB that accumulates rows.
function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Seed an article to edit through the real pipeline: create an itinerary, then
// generate its article (rich canonical blocks + a real authenticity score).
async function seedArticle(): Promise<{ id: string }> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const itinRes = await ctx.post("/itineraries", {
    data: {
      title: uniqueTitle("Editable Trip"),
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

test.describe("block editor surface", () => {
  test("opens an item, edits the title + a block, saves, and persists across reload", async ({
    page,
  }) => {
    const { id } = await seedArticle();

    await page.goto(`/editor?id=${id}`);

    // The editor + the persistent authenticity meter render.
    await expect(page.getByTestId("surface-editor")).toBeVisible();
    await expect(page.getByTestId("editor-title")).toBeVisible();
    await expect(page.getByTestId("authenticity-meter")).toBeVisible();
    await expect(page.getByTestId("meter-score")).toBeVisible();

    // Edit the title and the first editable text block.
    const newTitle = uniqueTitle("Riscritto a mano");
    await page.getByTestId("editor-title").fill(newTitle);

    const firstBlock = page.getByTestId(/^block-text-\d+$/).first();
    await expect(firstBlock).toBeVisible();
    const newBlockText = "Ho camminato per Kyoto all'alba, tra i templi silenziosi.";
    await firstBlock.fill(newBlockText);

    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("save-status")).toBeVisible();

    // Reload from scratch — the edits must have been persisted server-side.
    await page.goto(`/editor?id=${id}`);
    await expect(page.getByTestId("editor-title")).toHaveValue(newTitle);
    await expect(page.getByTestId(/^block-text-\d+$/).first()).toHaveValue(newBlockText);

    // The meter is still present as a persistent counterweight.
    await expect(page.getByTestId("authenticity-meter")).toBeVisible();
  });
});
