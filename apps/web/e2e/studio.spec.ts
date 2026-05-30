import { test, expect } from "@playwright/test";

// Resolved relative to the Playwright cwd (apps/web).
const photo = "e2e/fixtures/photo.jpg";

test("itinerary + photo → published article", async ({ page }) => {
  await page.goto("/studio");

  // 1) create the itinerary (form is prefilled with a Japan trip)
  await page.getByTestId("create-itinerary").click();
  await expect(page.getByTestId("itinerary-ready")).toBeVisible();

  // 2) upload a photo (EXIF dated within the Kyoto stop → auto-organized)
  await page.getByTestId("photo-input").setInputFiles(photo);
  await page.getByTestId("upload-photo").click();
  await expect(page.getByTestId("photo-ready")).toBeVisible();

  // 3) generate the article — the photo is woven into a section
  await page.getByTestId("generate-article").click();
  await expect(page.getByTestId("article-draft")).toBeVisible();
  await expect(page.getByTestId("block-image")).toBeVisible();
  await expect(page.getByTestId("authenticity")).toBeVisible();

  // 4) publish → status reaches "published"
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("published")).toHaveText(/published/);
});
