"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Mirrors @blogs/contracts TripView/DepartureView/BookingView. apps/web doesn't
// depend on the contracts package (the other surfaces inline their types too).
interface Departure {
  id: string;
  tripId: string;
  departureDate: string;
  seats: number;
  booked: number;
  available: number;
  waitlisted: number;
  status: string;
}
interface Trip {
  id: string;
  title: string;
  theme: string | null;
  priceCents: number;
  depositCents: number;
  currency: string;
  departures: Departure[];
}
interface Booking {
  id: string;
  status: string;
  paymentRef: string | null;
}

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/**
 * Trips surface (Fase 3, motion "Programmato"): list scheduled departures with
 * live seat usage and run the book → deposit → confirm flow (waitlist when full).
 * Thin by design — the booking engine + state machine live in the API.
 */
export default function TripsSurface() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-departure: the email being typed, and the last booking made.
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/trips`);
      if (!res.ok) {
        setError("Caricamento viaggi fallito");
        return;
      }
      setTrips((await res.json()).trips as Trip[]);
    } catch {
      setError("Caricamento viaggi fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function book(departureId: string) {
    const customerEmail = (emails[departureId] ?? "").trim();
    if (!customerEmail) return;
    setBusy(departureId);
    setError(null);
    try {
      const res = await fetch(`${API}/departures/${departureId}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerEmail }),
      });
      if (!res.ok) {
        setError("Prenotazione fallita (controlla l'email).");
        return;
      }
      const booking = (await res.json()) as Booking;
      setBookings((b) => ({ ...b, [departureId]: booking }));
      await load();
    } catch {
      setError("Prenotazione fallita.");
    } finally {
      setBusy(null);
    }
  }

  async function deposit(departureId: string, bookingId: string) {
    setBusy(departureId);
    setError(null);
    try {
      const res = await fetch(`${API}/bookings/${bookingId}/deposit`, { method: "POST" });
      if (!res.ok) {
        setError("Versamento acconto fallito.");
        return;
      }
      const booking = (await res.json()) as Booking;
      setBookings((b) => ({ ...b, [departureId]: booking }));
      await load();
    } catch {
      setError("Versamento acconto fallito.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="surface-trips">
      <PageHeader
        testId="trips-header"
        title="Viaggi programmati"
        subtitle="Lancia una partenza, prenota un posto e versa l'acconto. Se la partenza è piena, la prenotazione finisce in lista d'attesa."
      />

      {error && (
        <p data-testid="trips-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {loaded && trips.length === 0 && !error && (
        <Card testId="trips-empty">
          <p style={{ margin: 0, color: color.textMuted }}>
            Ancora nessun viaggio. Crea un Trip (da un itinerario) e lancia una partenza via API.
          </p>
        </Card>
      )}

      <ul
        data-testid="trips-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.lg }}
      >
        {trips.map((t) => (
          <li key={t.id} data-testid="trip-item" data-trip-id={t.id}>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: space.md }}>
                <h2 style={{ fontSize: font.size.lg, margin: 0, color: color.text }}>{t.title}</h2>
                <span style={{ color: color.textMuted, fontSize: font.size.sm }}>
                  {money(t.priceCents, t.currency)}{" "}
                  <span title="acconto">(acconto {money(t.depositCents, t.currency)})</span>
                </span>
              </div>

              <ul
                style={{ listStyle: "none", margin: `${space.md} 0 0`, padding: 0, display: "grid", gap: space.md }}
              >
                {t.departures.length === 0 && (
                  <li style={{ color: color.textMuted, fontSize: font.size.sm }}>
                    Nessuna partenza programmata.
                  </li>
                )}
                {t.departures.map((d) => {
                  const booking = bookings[d.id];
                  return (
                    <li
                      key={d.id}
                      data-testid="departure-item"
                      data-departure-id={d.id}
                      style={{
                        borderTop: `1px solid ${color.border}`,
                        paddingTop: space.md,
                        display: "grid",
                        gap: space.sm,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: space.md }}>
                        <span style={{ fontWeight: 600, color: color.text }}>{d.departureDate}</span>
                        <span data-testid="departure-usage" style={{ color: color.textMuted, fontSize: font.size.sm }}>
                          {d.booked}/{d.seats} posti · {d.available} liberi · {d.waitlisted} in attesa
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          data-testid="book-email"
                          value={emails[d.id] ?? ""}
                          onChange={(e) => setEmails((m) => ({ ...m, [d.id]: e.target.value }))}
                          placeholder="email cliente"
                          style={inputStyle}
                        />
                        <button
                          data-testid="book-submit"
                          onClick={() => book(d.id)}
                          disabled={busy === d.id || !(emails[d.id] ?? "").trim()}
                          style={buttonStyle(busy !== d.id && Boolean((emails[d.id] ?? "").trim()))}
                        >
                          {d.available > 0 ? "Prenota posto" : "Metti in lista d'attesa"}
                        </button>

                        {booking && (
                          <span
                            data-testid="booking-status"
                            data-status={booking.status}
                            style={{ fontWeight: 600, color: color.text }}
                          >
                            {booking.status}
                          </span>
                        )}
                        {booking && booking.status === "reserved" && (
                          <button
                            data-testid="deposit-submit"
                            onClick={() => deposit(d.id, booking.id)}
                            disabled={busy === d.id}
                            style={buttonStyle(busy !== d.id)}
                          >
                            Versa acconto
                          </button>
                        )}
                        {booking?.paymentRef && (
                          <span data-testid="payment-ref" style={{ color: color.textMuted, fontSize: font.size.sm }}>
                            {booking.paymentRef}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

const inputStyle = {
  fontSize: font.size.md,
  padding: space.sm,
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.surface,
  color: color.text,
  fontFamily: font.family,
};

function buttonStyle(enabled: boolean) {
  return {
    fontSize: font.size.md,
    fontWeight: 600,
    padding: `${space.sm} ${space.lg}`,
    borderRadius: radius.sm,
    border: "none",
    background: enabled ? color.accent : color.border,
    color: "#fff",
    cursor: enabled ? "pointer" : "default",
  };
}
