import { test, expect } from "@playwright/test";

// Step B — channel onboarding from the Hub: connect Instagram (a real sealed,
// per-tenant credential is stored; only the Meta consent is stubbed), see the
// connected status, then disconnect. Normalizes the shared-DB starting state.
test("connect and disconnect Instagram from the Channels surface", async ({ page }) => {
  await page.goto("/channels");
  await expect(page.getByTestId("surface-channels")).toBeVisible();

  const ig = page.locator(`[data-testid="channel-item"][data-channel="instagram"]`);
  await expect(ig).toBeVisible();

  // Known starting point: if a prior run left it connected, disconnect first.
  if ((await ig.getAttribute("data-connected")) === "true") {
    await ig.getByTestId("channel-disconnect").click();
    await expect(ig).toHaveAttribute("data-connected", "false");
  }

  await ig.getByTestId("channel-connect").click();
  await expect(ig).toHaveAttribute("data-connected", "true");
  await expect(ig.getByTestId("channel-status")).toContainText("Connesso");

  // Disconnect returns it to not-connected (assertion + cleanup).
  await ig.getByTestId("channel-disconnect").click();
  await expect(ig).toHaveAttribute("data-connected", "false");
  await expect(ig.getByTestId("channel-status")).toContainText("Non connesso");
});
