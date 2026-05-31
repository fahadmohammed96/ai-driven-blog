import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Slice 5 — the full cross-surface hub journey. ONE journey exercising the whole
// content-hub as a coherent product: from /hub the founder moves freely across
// the four INDEPENDENT tools (Library, Block Editor, Proposal Queue, Settings)
// — a toolbox, not a wizard (ADR-0021). It encodes the operating model end to
// end: the agency proposes, the human confirms; the authenticity meter is the
// counterweight; navigation has no forced order.
//
// We self-seed straight through the API (as the per-surface specs do): one
// generated article (rich canonical blocks + a real authenticity score) for the
// Library→Editor leg, and one proposed item for the Proposal Queue leg. Items
// accumulate in the shared dev DB across runs, so EVERY assertion is scoped to
// THIS run's unique titles — never to total list length.

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Generate a real article via the pipeline (itinerary → article): it lands in the
// Library as a draft and opens in the Block Editor with a live authenticity meter.
async function seedArticle(request: APIRequestContext, title: string): Promise<string> {
  const itin = await request.post(`${API}/itineraries`, {
    data: {
      title,
      stops: [
        { place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04" },
        { place: "Kyoto", startDate: "2026-04-05", endDate: "2026-04-07" },
      ],
    },
  });
  expect(itin.ok()).toBeTruthy();
  const itineraryId = (await itin.json()).id as string;

  const art = await request.post(`${API}/itineraries/${itineraryId}/article`, { data: {} });
  expect(art.ok()).toBeTruthy();
  return (await art.json()).articleId as string;
}

// Seed a draft itinerary, then `propose` it so it lands in the Proposal Queue.
async function seedProposal(request: APIRequestContext, title: string): Promise<string> {
  const created = await request.post(`${API}/itineraries`, {
    data: { title, stops: [{ place: "Lisbona", startDate: "2026-04-01", endDate: "2026-04-03" }] },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as string;
  const proposed = await request.post(`${API}/articles/${id}/propose`);
  expect(proposed.ok()).toBeTruthy();
  expect((await proposed.json()).status).toBe("proposed");
  return id;
}

test("hub journey: one coherent product across the four independent tools", async ({
  page,
  request,
}) => {
  const articleTitle = uniqueTitle("Journey Articolo");
  const proposalTitle = uniqueTitle("Journey Proposta");
  const articleId = await seedArticle(request, articleTitle);
  await seedProposal(request, proposalTitle);

  // 0) The hub home orients the founder: it states the operating model (agency
  //    proposes → human confirms; toolbox, not wizard) and lists the tools.
  await page.goto("/hub");
  await expect(page.getByRole("heading", { name: /content hub/i })).toBeVisible();
  await expect(page.getByTestId("hub-operating-model")).toBeVisible();
  const nav = page.getByTestId("toolbox-nav");
  await expect(nav).toBeVisible();

  // 1) LIBRARY — open it from the toolbox; the seeded article shows with a draft
  //    badge. The Library → Editor navigation contract is /editor?id=<id>.
  //    NB: seeding creates BOTH an itinerary and the article generated from it,
  //    with the same title → two Library rows. Scope to the ARTICLE row
  //    (data-type="article") — that's the item we open in the Editor.
  await nav.getByTestId("nav-library").click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("library-header")).toBeVisible();
  const libItem = page
    .locator('[data-testid="library-item"][data-type="article"]')
    .filter({ hasText: articleTitle });
  await expect(libItem).toBeVisible();
  await expect(libItem.getByTestId("state-badge-draft")).toBeVisible();

  // 2) EDITOR — clicking the Library row opens the canonical block editor for
  //    that item, with the authenticity meter as a persistent counterweight.
  await libItem.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/editor\\?id=${articleId}`));
  await expect(page.getByTestId("editor-header")).toBeVisible();
  await expect(page.getByTestId("authenticity-meter")).toBeVisible();
  await expect(page.getByTestId("meter-score")).toBeVisible();

  // Edit the title + the first text block, then save (the human's craft).
  const editedTitle = uniqueTitle("Riscritto a mano");
  await page.getByTestId("editor-title").fill(editedTitle);
  const firstBlock = page.getByTestId(/^block-text-\d+$/).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.fill("Ho percorso Kyoto all'alba, fra i templi ancora silenziosi.");
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("save-status")).toBeVisible();
  // The meter stays present after saving (informational, never a gate).
  await expect(page.getByTestId("authenticity-meter")).toBeVisible();
  // The edit really persisted server-side.
  const reread = await request.get(`${API}/articles/${articleId}`);
  expect((await reread.json()).title).toBe(editedTitle);

  // 3) PROPOSAL QUEUE — jump straight here from the toolbox (NO forced order:
  //    we did not "advance" from the editor; we picked the next tool freely).
  //    The toolbox rail persists across surfaces (app-shell chrome).
  await expect(nav).toBeVisible();
  await nav.getByTestId("nav-proposals").click();
  await expect(page).toHaveURL(/\/proposals$/);
  await expect(page.getByTestId("proposals-header")).toBeVisible();
  const proposal = page.getByTestId("proposal-item").filter({ hasText: proposalTitle });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByTestId("state-badge-proposed")).toBeVisible();

  // The universal gesture: approve → the item advances through the real state
  // machine and leaves the queue.
  const proposalId = await proposal.getAttribute("data-id");
  await proposal.getByTestId("proposal-approve").click();
  await expect(proposal).toHaveCount(0);
  const approved = await request.get(`${API}/articles/${proposalId}`);
  expect((await approved.json()).status).toBe("approved");

  // 4) SETTINGS — reachable directly from the toolbox; change a setting and
  //    confirm it persists across a full reload (tenant-scoped persistence).
  await page.getByTestId("toolbox-nav").getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("settings-header")).toBeVisible();
  const newTone = uniqueTitle("tono");
  await page.getByTestId("settings-voice-tone").fill(newTone);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-save-status")).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByTestId("settings-voice-tone")).toHaveValue(newTone);
});
