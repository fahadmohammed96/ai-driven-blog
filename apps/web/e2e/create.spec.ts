import { test, expect } from "@playwright/test";

// Slice A1 — the Hub becomes a control panel: you can ORIGINATE a new article
// from inside the Hub (no more leaving for /studio). Create from a trip ->
// generated draft -> land in the Block Editor -> publish, all from the Hub.
test("create a new article from the hub, land in the editor, and publish", async ({ page }) => {
  await page.goto("/create");
  await expect(page.getByTestId("surface-create")).toBeVisible();

  await page
    .getByTestId("create-title")
    .fill(`Nuovo viaggio ${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  await page.getByTestId("create-generate").click();

  // Lands in the Block Editor with the freshly generated draft.
  await expect(page).toHaveURL(/\/editor\?id=/);
  await expect(page.getByTestId("surface-editor")).toBeVisible();
  await expect(page.getByTestId("editor-title")).toBeVisible();

  // The create -> publish loop is now fully inside the Hub.
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("state-badge-published")).toBeVisible();
});
