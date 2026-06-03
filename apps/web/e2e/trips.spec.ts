import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Phase 3 — Slice 2: Commerce (motion "Programmato").
// ROADMAP acceptance: "launch a Departure → book a seat → deposit → confirm is
// green (waitlist when full)."
//
// The Trip + Departure are seeded via the API (a Trip is built on an itinerary),
// then the book → deposit → confirm flow is driven THROUGH the /trips surface,
// and the full→waitlist path is exercised. Rows accumulate in the shared dev DB
// across runs, so every assertion is scoped to THIS run's unique trip.

test.describe("trips (commerce — Programmato)", () => {
  test("book a seat → deposit → confirm, then a second booking is waitlisted (full)", async ({
    page,
    request,
  }) => {
    const title = `e2e-trip-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    // 1) Seed an itinerary, a Trip on it, and a single-seat Departure (via API).
    const itinerary = await (
      await request.post(`${API}/itineraries`, {
        data: {
          title: `${title}-itinerary`,
          stops: [{ place: "Tokyo", startDate: "2026-11-15", endDate: "2026-11-20" }],
        },
      })
    ).json();
    const trip = await (
      await request.post(`${API}/trips`, {
        data: { itineraryId: itinerary.id, title, priceCents: 150_000, depositCents: 30_000 },
      })
    ).json();
    await request.post(`${API}/trips/${trip.id}/departures`, {
      data: { departureDate: "2026-11-15", seats: 1 },
    });

    // 2) Open the Trips surface and find this run's trip + its departure.
    await page.goto("/trips");
    await expect(page.getByTestId("surface-trips")).toBeVisible();
    const tripItem = page.getByTestId("trip-item").filter({ hasText: title });
    await expect(tripItem).toBeVisible();
    const departure = tripItem.getByTestId("departure-item");
    await expect(departure.getByTestId("departure-usage")).toContainText("0/1");

    // 3) Book the only seat → reserved.
    await departure.getByTestId("book-email").fill("ada@example.com");
    await departure.getByTestId("book-submit").click();
    await expect(departure.getByTestId("booking-status")).toHaveAttribute("data-status", "reserved");

    // 4) Pay the deposit (stub) → confirmed, with a deterministic payment ref.
    await departure.getByTestId("deposit-submit").click();
    await expect(departure.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
    await expect(departure.getByTestId("payment-ref")).toContainText("pi_stub_");

    // 5) The seat is now taken.
    await page.goto("/trips");
    const reloaded = page
      .getByTestId("trip-item")
      .filter({ hasText: title })
      .getByTestId("departure-item");
    await expect(reloaded.getByTestId("departure-usage")).toContainText("1/1");
    await expect(reloaded.getByTestId("departure-usage")).toContainText("0 liberi");

    // 6) A second booking on the full departure → waitlisted.
    await reloaded.getByTestId("book-email").fill("bob@example.com");
    await reloaded.getByTestId("book-submit").click();
    await expect(reloaded.getByTestId("booking-status")).toHaveAttribute("data-status", "waitlisted");
  });
});
