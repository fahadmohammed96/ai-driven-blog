import { test, expect } from "@playwright/test";

// Settings surface (slice 4): the founder configures brand voice, the
// per-specialist autonomy stub (default manual), and channels. Settings are
// tenant-scoped and persisted (GET /settings + PUT /settings). This journey
// edits a setting, saves, reloads from scratch, and asserts it persisted.

// Unique value so the assertion survives a shared dev DB across runs.
function uniqueTone(): string {
  return `tono ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

test.describe("settings surface", () => {
  test("edits brand voice + an autonomy knob, saves, and persists across reload", async ({
    page,
  }) => {
    await page.goto("/settings");

    // The surface + its three sections render.
    await expect(page.getByTestId("surface-settings")).toBeVisible();
    await expect(page.getByTestId("settings-header")).toBeVisible();
    await expect(page.getByTestId("settings-voice")).toBeVisible();
    await expect(page.getByTestId("settings-autonomy")).toBeVisible();
    await expect(page.getByTestId("settings-channels")).toBeVisible();

    // The autonomy knob is labelled as a stub taking effect in a later build.
    await expect(page.getByTestId("settings-autonomy-note")).toBeVisible();

    // Edit the brand voice tone and the writer's autonomy level.
    const newTone = uniqueTone();
    await page.getByTestId("settings-voice-tone").fill(newTone);
    await page.getByTestId("settings-autonomy-writer").selectOption("semi-auto");
    // Enable a channel too, to exercise the channels section.
    await page.getByTestId("settings-channel-instagram-toggle").check();

    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save-status")).toBeVisible();

    // Reload from scratch — the edits must have been persisted server-side.
    await page.goto("/settings");
    await expect(page.getByTestId("settings-voice-tone")).toHaveValue(newTone);
    await expect(page.getByTestId("settings-autonomy-writer")).toHaveValue("semi-auto");
    await expect(page.getByTestId("settings-channel-instagram-toggle")).toBeChecked();
  });
});
