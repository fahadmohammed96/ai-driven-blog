import { test, expect } from "@playwright/test";

test("homepage shows the app title", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Blogs Manager" }),
  ).toBeVisible();
});
