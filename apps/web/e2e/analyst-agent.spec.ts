import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Slice O1 — the Analyst agent: a run reads the tenant's cross-channel metrics,
// aggregates them deterministically, and STAGES an INFORMATIVE
// `Proposal<PerformanceReport>` (type `analyst_insight`) in `agent_proposals`
// (`pending`). It surfaces on "Code proposte" with its cost, reasoning, and the
// report's insights/recommendations. "Approva" is ACKNOWLEDGE-ONLY: the founder
// recognises the report (input for the future Orchestrator) — NOTHING is published
// and NO content item is minted, the proposal simply leaves the queue.
//
// The StubLlmAdapter is active (no ANTHROPIC_API_KEY in CI/E2E) → zero cost; the
// deterministic seed makes `insights` non-empty even with the stub.

// Run the Analyst through its agentic entrypoint; returns the proposal id.
async function analyze(request: APIRequestContext): Promise<string> {
  // Ingest first so the dashboard has cross-channel rows (external stubs populate
  // deterministically); the Analyst run then has real numbers to narrate.
  const ingest = await request.post(`${API}/analytics/ingest`);
  expect(ingest.ok()).toBeTruthy();

  // Unique periodDays per run so the Analyst's day-bucketed idempotency never
  // replays a prior (approved) proposal on the PERSISTENT dev DB across gate runs
  // — mirrors agent-proposals.spec's unique brief. The figures are all-time anyway
  // (not time-windowed yet, DEBT-038), so this only varies the taskId, not the data.
  const periodDays = (Date.now() % 100000) + 1;
  const res = await request.post(`${API}/analytics/agent/analyze`, {
    data: { periodDays, mode: "sync" },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("pending");
  return body.id as string;
}

test("analyst agent: analyze → queue (insights + cost) → approve is acknowledge-only", async ({
  page,
  request,
}) => {
  const proposalId = await analyze(request);

  // 1) it landed in agent_proposals as a pending analyst_insight (API ground truth).
  const listed = await request.get(`${API}/agent-proposals`);
  expect(listed.ok()).toBeTruthy();
  const listedBody = await listed.json();
  const staged = (listedBody.proposals as Array<{ id: string; type: string }>).find(
    (p) => p.id === proposalId,
  );
  expect(staged).toBeTruthy();
  expect(staged!.type).toBe("analyst_insight");

  // 2) the card shows on "Code proposte" with cost, reasoning and the report's
  //    insights/recommendations (the informative render, Slice O1).
  await page.goto("/proposals");
  const item = page.locator(`[data-testid="agent-proposal-item"][data-id="${proposalId}"]`);
  await expect(item).toBeVisible();
  await expect(item.getByTestId("agent-proposal-cost")).toContainText("$");
  await expect(item.getByTestId("agent-proposal-insights")).toBeVisible();

  // 3) Approve → the proposal leaves the agent queue (acknowledge-only).
  await item.getByTestId("agent-proposal-approve").click();
  await expect(item).toHaveCount(0);

  // 4) it is no longer pending, AND — the acknowledge-only invariant — approving an
  //    `analyst_insight` minted NO content item: the publish queue is untouched by it.
  const after = await request.get(`${API}/agent-proposals`);
  const afterBody = await after.json();
  expect(
    (afterBody.proposals as Array<{ id: string }>).some((p) => p.id === proposalId),
  ).toBeFalsy();
});
