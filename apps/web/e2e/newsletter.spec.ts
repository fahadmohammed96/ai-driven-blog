import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const MAILHOG = process.env.MAILHOG_URL ?? "http://localhost:8025";

interface MailhogItem {
  Content?: { Headers?: { To?: string[] }; Body?: string };
}

/** Quoted-printable cleanup: drop soft line-breaks, decode '=3D' → '='. */
function unqp(raw: string): string {
  return raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=");
}

test("newsletter: subscribe → confirm (Mailhog) → segmented send", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@test.dev`;
  const theme = "party";

  // 1) subscribe via the UI — double opt-in fires a confirmation email
  await page.goto("/newsletter");
  await page.getByTestId("nl-email").fill(email);
  await page.getByTestId("nl-theme").fill(theme);
  await page.getByTestId("nl-subscribe").click();
  await expect(page.getByTestId("nl-subscribed")).toBeVisible();

  // 2) pull MY confirmation email from Mailhog and extract the tokenized link
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILHOG}/api/v2/messages`);
        const body = (await res.json()) as { items?: MailhogItem[] };
        for (const m of body.items ?? []) {
          if (!(m.Content?.Headers?.To ?? []).join(",").includes(email)) continue;
          const match = unqp(m.Content?.Body ?? "").match(
            /\/newsletter\/confirm\?token=([0-9a-fA-F-]{36})/,
          );
          if (match) {
            token = match[1];
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000, intervals: [1_000] },
    )
    .toBe(true);

  // follow the tokenized link (the GDPR consent step)
  const confirm = await request.get(`${API}/newsletter/confirm?token=${token}`);
  expect(confirm.ok()).toBeTruthy();

  // 3) send a segmented newsletter from the UI → the confirmed subscriber is a recipient
  await page.getByTestId("nl-send-theme").fill(theme);
  await page.getByTestId("nl-send-subject").fill("Serata in spiaggia");
  await page.getByTestId("nl-send-html").fill("<h1>Ci vediamo!</h1>");
  await page.getByTestId("nl-send").click();
  await expect(page.getByTestId("nl-sent")).toHaveText(/Inviata a [1-9]\d* destinatari/);
});
