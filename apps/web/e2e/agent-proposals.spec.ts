import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Slice T1 — the agentic Proposal Queue: a Writer-agent run STAGES a
// `Proposal<content_draft>` in `agent_proposals` (`pending`); it surfaces on
// "Code proposte" with its estimated cost, the tenant's residual budget, the
// agent's reasoning and definition version; "Approva" injects the payload into
// the existing Phase-1 publish state machine (a fresh content item, draft →
// review) and marks the proposal `approved`. Nothing is published automatically.
//
// The StubLlmAdapter is active (no ANTHROPIC_API_KEY in CI/E2E) → zero cost.
// Items accumulate in the shared dev DB, so every assertion is scoped to THIS
// run's unique title — never to total list length.

// Trigger the Writer agent through its agentic entrypoint; returns the proposal id.
async function generateProposal(
  request: APIRequestContext,
  brief: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API}/agent-proposals/generate`, {
    data: { brief, title },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("pending");
  return body.id as string;
}

test("agent proposal: generate → queue (cost + budget + reasoning) → approve → draft→review", async ({
  page,
  request,
}) => {
  const ts = Date.now();
  const title = `E2E Agente ${ts}`;
  const brief = `Un itinerario unico per il test ${ts}`;

  const proposalId = await generateProposal(request, brief, title);

  // 1) it landed in agent_proposals as pending (API ground truth).
  const listed = await request.get(`${API}/agent-proposals`);
  expect(listed.ok()).toBeTruthy();
  const listedBody = await listed.json();
  expect(typeof listedBody.tenantBudgetResiduoUsd).toBe("number");
  expect(
    (listedBody.proposals as Array<{ id: string }>).some((p) => p.id === proposalId),
  ).toBeTruthy();

  // 2) the card shows on "Code proposte" with cost, residual budget, reasoning,
  //    definition version.
  await page.goto("/proposals");
  const card = page.getByTestId("agent-proposal-item").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(page.getByTestId("agent-budget-residuo")).toContainText("$");
  await expect(card.getByTestId("agent-proposal-cost")).toContainText("$");
  await expect(card.getByTestId("agent-proposal-version")).toBeVisible();
  // The reasoning is collapsed but present (the agent's tool-call trace + rationale).
  await expect(card.getByTestId("agent-proposal-reasoning")).toBeVisible();

  // 3) Approve → the proposal leaves the agent queue.
  await card.getByTestId("agent-proposal-approve").click();
  await expect(card).toHaveCount(0);

  // 4) the proposal is now `approved` and a content item entered the publish
  //    state machine at `review` (the Phase-1 gate consumed the staging row).
  const after = await request.get(`${API}/agent-proposals`);
  const afterBody = await after.json();
  expect(
    (afterBody.proposals as Array<{ id: string }>).some((p) => p.id === proposalId),
  ).toBeFalsy();

  const inReview = await request.get(`${API}/articles?status=review`);
  const reviewItems = (await inReview.json()).items as Array<{ title: string }>;
  expect(reviewItems.some((i) => i.title === title)).toBeTruthy();
});

// Slice A2 — the founder can ASK the AI to propose from the Proposals surface
// itself (no API/job needed): fill the brief, trigger the Writer agent, and the
// staged proposal shows up in the queue, ready to approve.
test("ask the AI to propose from the Proposals surface → the card appears and is actionable", async ({
  page,
}) => {
  const ts = Date.now();
  const title = `E2E UI Agente ${ts}`;

  await page.goto("/proposals");
  await page.getByTestId("agent-generate-title").fill(title);
  await page.getByTestId("agent-generate-brief").fill(`Brief unico per il test ${ts}`);
  await page.getByTestId("agent-generate-submit").click();

  const card = page.getByTestId("agent-proposal-item").filter({ hasText: title });
  await expect(card).toBeVisible();

  // It is immediately actionable: approve consumes it into the publish queue.
  await card.getByTestId("agent-proposal-approve").click();
  await expect(card).toHaveCount(0);
});
