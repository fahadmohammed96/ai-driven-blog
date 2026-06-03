"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface Stop {
  place: string;
  startDate: string;
  endDate: string;
}

const DEFAULT_STOPS: Stop[] = [
  { place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04" },
  { place: "Kyoto", startDate: "2026-04-05", endDate: "2026-04-07" },
];

/**
 * "Crea" surface (slice A1): the Hub's single entry point to ORIGINATE a new
 * article. Reuses the Fase-1 travel pipeline (itinerary -> generated draft) and
 * drops the founder straight into the Block Editor, where the authenticity
 * meter + the Pubblica action close the loop — no more leaving the Hub for
 * /studio. (Photos + the "ask the AI to propose" path arrive in later slices.)
 */
export default function CreateSurface() {
  const router = useRouter();
  const [title, setTitle] = useState("Il mio viaggio");
  const [stops, setStops] = useState<Stop[]>(DEFAULT_STOPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchStop(i: number, patch: Partial<Stop>) {
    setStops((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  async function createAndGenerate() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const itinRes = await fetch(`${API}/itineraries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, stops }),
      });
      if (!itinRes.ok) throw new Error(`Creazione itinerario fallita (${itinRes.status})`);
      const itineraryId = (await itinRes.json()).id as string;

      const artRes = await fetch(`${API}/itineraries/${itineraryId}/article`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!artRes.ok) throw new Error(`Generazione articolo fallita (${artRes.status})`);
      const articleId = (await artRes.json()).articleId as string;

      // Land in the Block Editor: edit + authenticity meter + Pubblica.
      router.push(`/editor?id=${articleId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore inatteso");
      setBusy(false);
    }
  }

  const disabled = busy || !title.trim();

  return (
    <div data-testid="surface-create">
      <PageHeader
        testId="create-header"
        title="Crea un articolo"
        subtitle="Parti da un viaggio: l'AI scrive la bozza nella tua brand voice, poi la rifinisci e pubblichi — senza uscire dall'Hub."
      />

      {error && (
        <p data-testid="create-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      <Card>
        <label style={labelStyle}>
          Titolo del viaggio
          <input
            data-testid="create-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ ...inputStyle, width: "100%" }}
          />
        </label>

        <p style={{ ...labelStyle, marginBottom: space.xs }}>Tappe</p>
        <div style={{ display: "grid", gap: space.sm }}>
          {stops.map((s, i) => (
            <div
              key={i}
              data-testid={`create-stop-${i}`}
              style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}
            >
              <input
                aria-label={`tappa ${i} luogo`}
                value={s.place}
                onChange={(e) => patchStop(i, { place: e.target.value })}
                style={{ ...inputStyle, flex: "2 1 140px" }}
              />
              <input
                aria-label={`tappa ${i} inizio`}
                type="date"
                value={s.startDate}
                onChange={(e) => patchStop(i, { startDate: e.target.value })}
                style={{ ...inputStyle, flex: "1 1 120px" }}
              />
              <input
                aria-label={`tappa ${i} fine`}
                type="date"
                value={s.endDate}
                onChange={(e) => patchStop(i, { endDate: e.target.value })}
                style={{ ...inputStyle, flex: "1 1 120px" }}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: space.lg, display: "flex", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
          <button
            data-testid="create-generate"
            onClick={createAndGenerate}
            disabled={disabled}
            style={{
              fontSize: font.size.md,
              fontWeight: 600,
              padding: `${space.sm} ${space.lg}`,
              borderRadius: radius.sm,
              border: "none",
              background: disabled ? color.border : color.accent,
              color: "#fff",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {busy ? "Generazione…" : "Crea e genera articolo"}
          </button>
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>
            Ti porta nel Block Editor con la bozza pronta.
          </span>
        </div>
      </Card>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: font.size.sm,
  color: color.textMuted,
  margin: `${space.md} 0 ${space.xs}`,
};

const inputStyle = {
  fontSize: font.size.md,
  padding: space.sm,
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.surface,
  color: color.text,
  fontFamily: font.family,
  boxSizing: "border-box" as const,
};
