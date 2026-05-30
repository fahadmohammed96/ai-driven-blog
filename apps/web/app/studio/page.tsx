"use client";

import { useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface Block {
  type: string;
  level?: number;
  text?: string;
  assetId?: string;
  alt?: string;
  caption?: string;
}

interface Article {
  articleId: string;
  blocks: Block[];
  authenticity: { score: number; flags: { suggestion: string }[] };
}

const DEFAULT_STOPS = [
  { place: "Tokyo", startDate: "2026-04-01", endDate: "2026-04-04" },
  { place: "Kyoto", startDate: "2026-04-05", endDate: "2026-04-07" },
];

export default function Studio() {
  const [title, setTitle] = useState("Il mio viaggio in Giappone");
  const [stops, setStops] = useState(DEFAULT_STOPS);
  const [itineraryId, setItineraryId] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [article, setArticle] = useState<Article | null>(null);
  const [published, setPublished] = useState<{ status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function createItinerary() {
    setError(null);
    const res = await fetch(`${API}/itineraries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, stops }),
    });
    if (!res.ok) return setError("Creazione itinerario fallita");
    setItineraryId((await res.json()).id);
  }

  async function uploadPhoto() {
    if (!itineraryId) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Seleziona una foto");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/itineraries/${itineraryId}/photos`, { method: "POST", body: form });
    if (!res.ok) return setError("Upload foto fallito");
    setPhotoCount((n) => n + 1);
  }

  async function generateArticle() {
    if (!itineraryId) return;
    const res = await fetch(`${API}/itineraries/${itineraryId}/article`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return setError("Generazione articolo fallita");
    setArticle(await res.json());
  }

  async function publish() {
    if (!article) return;
    const res = await fetch(`${API}/articles/${article.articleId}/publish`, { method: "POST" });
    if (!res.ok) return setError("Pubblicazione fallita");
    setPublished(await res.json());
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Studio — dall&apos;itinerario all&apos;articolo</h1>
      {error && <p data-testid="error" style={{ color: "crimson" }}>{error}</p>}

      <section>
        <h2>1. Itinerario</h2>
        <label>
          Titolo
          <input
            data-testid="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {stops.map((s, i) => (
          <fieldset key={i} data-testid={`stop-${i}`}>
            <input
              aria-label={`tappa ${i} luogo`}
              value={s.place}
              onChange={(e) => setStops((p) => p.map((x, j) => (j === i ? { ...x, place: e.target.value } : x)))}
            />
            <input
              aria-label={`tappa ${i} inizio`}
              type="date"
              value={s.startDate}
              onChange={(e) => setStops((p) => p.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x)))}
            />
            <input
              aria-label={`tappa ${i} fine`}
              type="date"
              value={s.endDate}
              onChange={(e) => setStops((p) => p.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x)))}
            />
          </fieldset>
        ))}
        <button data-testid="create-itinerary" onClick={createItinerary} disabled={!!itineraryId}>
          Crea itinerario
        </button>
        {itineraryId && <p data-testid="itinerary-ready">Itinerario creato ✓</p>}
      </section>

      {itineraryId && (
        <section>
          <h2>2. Foto</h2>
          <input data-testid="photo-input" ref={fileRef} type="file" accept="image/*" />
          <button data-testid="upload-photo" onClick={uploadPhoto}>Carica foto</button>
          {photoCount > 0 && <p data-testid="photo-ready">Foto caricate: {photoCount}</p>}
        </section>
      )}

      {itineraryId && (
        <section>
          <h2>3. Articolo</h2>
          <button data-testid="generate-article" onClick={generateArticle}>Genera articolo</button>
          {article && (
            <article data-testid="article-draft">
              <p data-testid="authenticity">
                Autenticità: {Math.round(article.authenticity.score * 100)}% — {article.authenticity.flags.length} sezioni
                da arricchire
              </p>
              {article.blocks.map((b, i) =>
                b.type === "heading" ? (
                  <h3 key={i}>{b.text}</h3>
                ) : b.type === "image" ? (
                  <figure key={i} data-testid="block-image">
                    <div aria-label={b.alt}>[foto: {b.alt}]</div>
                    {b.caption && <figcaption>{b.caption}</figcaption>}
                  </figure>
                ) : (
                  <p key={i}>{b.text}</p>
                ),
              )}
            </article>
          )}
        </section>
      )}

      {article && (
        <section>
          <h2>4. Pubblica</h2>
          <button data-testid="publish" onClick={publish}>Pubblica</button>
          {published && <p data-testid="published">Stato: {published.status}</p>}
        </section>
      )}
    </main>
  );
}
