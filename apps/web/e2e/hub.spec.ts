import { test, expect } from "@playwright/test";

// Slice 0 smoke: the content-hub app-shell loads, the toolbox nav renders, and
// each of the 4 surfaces is reachable as an INDEPENDENT section (toolbox, not a
// wizard) — no required ordering between them. Real functionality lands in
// later slices; here we only assert the shell + navigation + placeholders.

// Each surface: nav link testid → expected URL → surface root testid → the slice
// where the real feature arrives. Surfaces still scaffolded show the "coming in
// slice N" placeholder; ones already built (Library, slice 1) assert a real
// landmark instead — keeping the contract honest as later slices land.
const SURFACES = [
  { nav: "nav-library", path: "/library", surface: "surface-library", slice: 1, built: "library-list" },
  { nav: "nav-editor", path: "/editor", surface: "surface-editor", slice: 2, built: "editor-header" },
  { nav: "nav-proposals", path: "/proposals", surface: "surface-proposals", slice: 3, built: "proposals-header" },
  { nav: "nav-settings", path: "/settings", surface: "surface-settings", slice: 4, built: "settings-header" },
  { nav: "nav-affiliates", path: "/affiliates", surface: "surface-affiliates", slice: 1, built: "affiliates-header" },
] as const;

test("hub shell loads and the toolbox nav renders", async ({ page }) => {
  await page.goto("/hub");
  await expect(page.getByRole("heading", { name: /content hub/i })).toBeVisible();

  // The persistent toolbox nav links all 4 surfaces.
  const nav = page.getByTestId("toolbox-nav");
  await expect(nav).toBeVisible();
  for (const s of SURFACES) {
    await expect(nav.getByTestId(s.nav)).toBeVisible();
  }
});

test("each surface is reachable as an independent section via the toolbox", async ({ page }) => {
  for (const s of SURFACES) {
    // Start fresh from the hub each time: surfaces are independent, not steps.
    await page.goto("/hub");
    await page.getByTestId("toolbox-nav").getByTestId(s.nav).click();
    await expect(page).toHaveURL(new RegExp(`${s.path}$`));
    await expect(page.getByTestId(s.surface)).toBeVisible();
    // Every surface is now built (slices 1–4 landed): assert its real landmark.
    await expect(page.getByTestId(s.built)).toBeVisible();
    // The toolbox nav persists on every surface (app-shell, not per-page chrome).
    await expect(page.getByTestId("toolbox-nav")).toBeVisible();
  }
});
