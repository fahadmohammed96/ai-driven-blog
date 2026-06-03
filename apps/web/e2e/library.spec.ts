import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Slice 1 — the Library surface: it lists the tenant's ContentItems with a state
// badge each, and a filter narrows the list. We seed two items in distinct
// states straight through the API (an itinerary left as a draft + one walked to
// published), then assert the surface renders them and that filtering works.
//
// Items accumulate in the shared dev DB across runs, so every assertion is
// scoped to THIS run's unique titles — never to the total list length.

async function seedItinerary(
  request: import("@playwright/test").APIRequestContext,
  title: string,
): Promise<string> {
  const res = await request.post(`${API}/itineraries`, {
    data: {
      title,
      stops: [{ place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04" }],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

test("library lists items with state badges and filters narrow the list", async ({
  page,
  request,
}) => {
  const ts = Date.now();
  const draftTitle = `E2E Bozza ${ts}`;
  const publishedTitle = `E2E Pubblicato ${ts}`;

  // 1) a draft itinerary…
  await seedItinerary(request, draftTitle);
  // 2) …and a second item walked all the way to 'published'.
  const pubId = await seedItinerary(request, publishedTitle);
  expect((await request.post(`${API}/articles/${pubId}/publish`)).ok()).toBeTruthy();

  // 3) the Library renders both, each with the right state badge.
  await page.goto("/library");
  const draftItem = page.getByTestId("library-item").filter({ hasText: draftTitle });
  const publishedItem = page.getByTestId("library-item").filter({ hasText: publishedTitle });

  await expect(draftItem).toBeVisible();
  await expect(publishedItem).toBeVisible();
  await expect(draftItem.getByTestId("state-badge-draft")).toBeVisible();
  await expect(publishedItem.getByTestId("state-badge-published")).toBeVisible();

  // each item links toward the (slice-2) editor: /editor?id=<id>
  await expect(publishedItem.getByRole("link")).toHaveAttribute(
    "href",
    new RegExp(`/editor\\?id=${pubId}`),
  );

  // 4) filtering by status narrows the list: the draft drops out, the
  //    published item stays.
  await page.getByTestId("filter-status").selectOption("published");
  await expect(publishedItem).toBeVisible();
  await expect(draftItem).toHaveCount(0);
});
