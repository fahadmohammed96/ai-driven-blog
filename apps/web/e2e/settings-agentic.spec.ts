import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Slice T2 — the founder configures the agentic controls from /settings: the
// monthly AI budget cap, the AI provider (BYOK), the per-specialist autonomy,
// and the audit policy. These journeys prove the settings the founder edits in
// the UI drive the agentic surface (`/agent-proposals`) in the same session.
//
// The StubLlmAdapter is active in CI/E2E (no ANTHROPIC_API_KEY) → zero cost.
// Assertions are scoped to deltas / this run's values, never to shared totals.

async function getResiduo(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${API}/agent-proposals`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).tenantBudgetResiduoUsd as number;
}

async function getBudget(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${API}/settings`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).budgetUsdMonthly as number;
}

test.describe("settings drive the agentic surface", () => {
  test("saving a new budget cap is reflected in the proposal queue's residual budget", async ({
    page,
    request,
  }) => {
    // Baseline: current cap and the residual the gate shows (cap − month spend).
    const budget0 = await getBudget(request);
    const residuo0 = await getResiduo(request);

    // Raise the cap by a known delta from the UI and save.
    const budget1 = budget0 + 50;
    await page.goto("/settings");
    await expect(page.getByTestId("settings-budget-card")).toBeVisible();
    await page.getByTestId("settings-budget").fill(String(budget1));
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save-status")).toBeVisible();

    // The residual moved by exactly the cap delta (month spend is unchanged):
    // residuo = cap − spent, so Δresiduo == Δcap.
    const residuo1 = await getResiduo(request);
    expect(residuo1).toBeCloseTo(residuo0 + 50, 4);
    expect(await getBudget(request)).toBeCloseTo(budget1, 4);
  });

  test("the audit policy is editable, persists across reload, and gates the queue", async ({
    page,
    request,
  }) => {
    // best-effort: un-audited proposals are surfaced. (The hidden-under-strict
    // case for an auditRecorded=false proposal is exhaustively covered in the
    // agent-proposals HTTP integration test, which can seed such a row directly.)
    await page.goto("/settings");
    await expect(page.getByTestId("settings-audit-card")).toBeVisible();
    await page.getByTestId("settings-audit-policy").selectOption("best-effort");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save-status")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByTestId("settings-audit-policy")).toHaveValue("best-effort");

    // The queue still answers (best-effort never withholds) and an audited
    // proposal stays visible under either policy.
    const ts = Date.now();
    const title = `T2 audit ${ts}`;
    const gen = await request.post(`${API}/agent-proposals/generate`, {
      data: { brief: `Brief audit ${ts}`, title },
    });
    expect(gen.ok()).toBeTruthy();
    const proposalId = (await gen.json()).id as string;

    const bestEffort = await request.get(`${API}/agent-proposals`);
    expect(
      ((await bestEffort.json()).proposals as Array<{ id: string }>).some(
        (p) => p.id === proposalId,
      ),
    ).toBeTruthy();

    // Switch to obbligatorio — the audited proposal is still shown (it has a run).
    await page.goto("/settings");
    await page.getByTestId("settings-audit-policy").selectOption("obbligatorio");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save-status")).toBeVisible();

    const strict = await request.get(`${API}/agent-proposals`);
    expect(
      ((await strict.json()).proposals as Array<{ id: string }>).some((p) => p.id === proposalId),
    ).toBeTruthy();
  });

  test("BYOK: saving a key flips the provider to anthropic and never echoes the key", async ({
    page,
    request,
  }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-ai-card")).toBeVisible();
    await page.getByTestId("settings-ai-provider").selectOption("anthropic");
    await page.getByTestId("settings-ai-key").fill("sk-e2e-byok-secret");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save-status")).toBeVisible();

    // Reload: the provider is anthropic, the status reads "configurata", and the
    // key input is empty (write-only — never read back).
    await page.goto("/settings");
    await expect(page.getByTestId("settings-ai-provider")).toHaveValue("anthropic");
    await expect(page.getByTestId("settings-ai-key-status")).toContainText("configurata");
    await expect(page.getByTestId("settings-ai-key")).toHaveValue("");

    // The API never returns the plaintext key anywhere in the settings payload.
    const res = await request.get(`${API}/settings`);
    const text = await res.text();
    expect(text).not.toContain("sk-e2e-byok-secret");
  });

  test("auto-within-limits autonomy is disabled until the feature flag ships", async ({ page }) => {
    await page.goto("/settings");
    // The option exists but is disabled (propose-only, ADR-0020) — manual and
    // semi-auto remain selectable.
    const option = page.locator(
      '[data-testid="settings-autonomy-writer"] option[value="auto-within-limits"]',
    );
    await expect(option).toBeDisabled();
  });
});
