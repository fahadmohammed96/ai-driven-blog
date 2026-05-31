import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Slice 3 — the Proposal Queue: the universal gesture "specialist proposes →
// human approves / edits / rejects" over the existing publish state machine.
// We seed items straight through the API into the AWAITING state (`proposed`),
// open /proposals, then assert Approve advances the item (proposed→approved) and
// it leaves the queue, while Reject sends another back to draft and it leaves too.
//
// Items accumulate in the shared dev DB across runs, so every assertion is scoped
// to THIS run's unique titles — never to the total list length.

// Seed a draft itinerary, then `propose` it so it lands in the queue.
async function seedProposal(request: APIRequestContext, title: string): Promise<string> {
  const created = await request.post(`${API}/itineraries`, {
    data: { title, stops: [{ place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04" }] },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as string;
  const proposed = await request.post(`${API}/articles/${id}/propose`);
  expect(proposed.ok()).toBeTruthy();
  expect((await proposed.json()).status).toBe("proposed");
  return id;
}

test("proposals queue: approve advances the item and it leaves the queue; reject sends it back", async ({
  page,
  request,
}) => {
  const ts = Date.now();
  const approveTitle = `E2E Approva ${ts}`;
  const rejectTitle = `E2E Rifiuta ${ts}`;

  const approveId = await seedProposal(request, approveTitle);
  const rejectId = await seedProposal(request, rejectTitle);

  // 1) both proposals show in the queue, each with the `proposed` state badge.
  await page.goto("/proposals");
  const approveItem = page.getByTestId("proposal-item").filter({ hasText: approveTitle });
  const rejectItem = page.getByTestId("proposal-item").filter({ hasText: rejectTitle });

  await expect(approveItem).toBeVisible();
  await expect(rejectItem).toBeVisible();
  await expect(approveItem.getByTestId("state-badge-proposed")).toBeVisible();

  // Edit links to the slice-2 Block Editor (/editor?id=<id>).
  await expect(approveItem.getByTestId("proposal-edit")).toHaveAttribute(
    "href",
    new RegExp(`/editor\\?id=${approveId}`),
  );

  // 2) Approve: the item advances through the real state machine and leaves the
  //    queue (it is no longer proposed/review).
  await approveItem.getByTestId("proposal-approve").click();
  await expect(approveItem).toHaveCount(0);
  // The reject item is still awaiting a decision.
  await expect(rejectItem).toBeVisible();
  // The transition really persisted: proposed → approved.
  const approved = await request.get(`${API}/articles/${approveId}`);
  expect((await approved.json()).status).toBe("approved");

  // 3) Reject: the item goes back to draft and leaves the queue too.
  await rejectItem.getByTestId("proposal-reject").click();
  await expect(rejectItem).toHaveCount(0);
  const rejected = await request.get(`${API}/articles/${rejectId}`);
  expect((await rejected.json()).status).toBe("draft");
});
