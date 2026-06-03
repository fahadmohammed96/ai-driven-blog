"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, StateBadge, type PublicationStatus } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";
import { AuthenticityMeter, type AuthenticityScore } from "../AuthenticityMeter";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "image"; assetId: string; alt: string; caption?: string };

interface ContentItem {
  id: string;
  type: string;
  status: PublicationStatus;
  title: string;
  blocks: Block[];
  publishedAt: string | null;
}

const inputStyle = {
  display: "block",
  width: "100%",
  fontSize: font.size.md,
  padding: space.sm,
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.surface,
  color: color.text,
  fontFamily: font.family,
  boxSizing: "border-box" as const,
};

const labelStyle = {
  display: "block",
  fontSize: font.size.sm,
  color: color.textMuted,
  margin: `${space.md} 0 ${space.xs}`,
};

export default function EditorSurface() {
  const [id, setId] = useState<string | null>(null);
  const [item, setItem] = useState<ContentItem | null>(null);
  const [meter, setMeter] = useState<AuthenticityScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Read the item id from the query string (?id=…) on the client.
  useEffect(() => {
    const qid = new URLSearchParams(window.location.search).get("id");
    setId(qid);
    if (!qid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API}/articles/${qid}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Caricamento contenuto fallito (${res.status})`);
        return res.json();
      })
      .then((data: ContentItem) => {
        setItem(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Errore inatteso"))
      .finally(() => setLoading(false));
    refreshMeter(qid);
  }, []);

  function refreshMeter(itemId: string) {
    fetch(`${API}/articles/${itemId}/authenticity`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthenticityScore | null) => setMeter(data))
      .catch(() => setMeter(null));
  }

  function patchBlock(index: number, patch: Partial<Block>) {
    setItem((cur) =>
      cur
        ? { ...cur, blocks: cur.blocks.map((b, i) => (i === index ? ({ ...b, ...patch } as Block) : b)) }
        : cur,
    );
    setSaved(false);
  }

  async function save() {
    if (!item || !id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/articles/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: item.title, blocks: item.blocks }),
      });
      if (!res.ok) throw new Error(`Salvataggio fallito (${res.status})`);
      const updated = (await res.json()) as ContentItem;
      setItem(updated);
      setSaved(true);
      refreshMeter(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore inatteso");
    } finally {
      setSaving(false);
    }
  }

  // Close the publish loop inside the new UI: walk the item through the state
  // machine to `published` via the existing idempotent endpoint (the same one
  // /studio calls). The agency model proposes → approves; this is the founder's
  // final "confirm" that takes an item live, without leaving the Content Hub.
  async function publish() {
    if (!item || !id) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`${API}/articles/${id}/publish`, { method: "POST" });
      if (!res.ok) throw new Error(`Pubblicazione fallita (${res.status})`);
      const result = (await res.json()) as { status: PublicationStatus; publishedAt: string | null };
      setItem((cur) => (cur ? { ...cur, status: result.status, publishedAt: result.publishedAt } : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore inatteso");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div data-testid="surface-editor">
      <PageHeader
        testId="editor-header"
        title="Block Editor"
        subtitle="Modifica un contenuto sul modello a blocchi canonico. Il misuratore di autenticità è un contrappeso, mai un cancello."
      />

      {loading && <p>Caricamento…</p>}

      {!loading && !id && (
        <Card testId="editor-empty">
          <p style={{ margin: 0, color: color.textMuted }}>
            Apri un contenuto dalla Library per modificarlo.
          </p>
        </Card>
      )}

      {error && (
        <p data-testid="editor-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {!loading && item && (
        <div style={{ display: "flex", gap: space.xl, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 460px", minWidth: 320 }}>
            <div style={{ display: "flex", alignItems: "center", gap: space.md, marginBottom: space.md }}>
              <StateBadge status={item.status} />
              <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{item.type}</span>
            </div>

            <label style={labelStyle}>
              Titolo
              <input
                data-testid="editor-title"
                value={item.title}
                onChange={(e) => {
                  const title = e.target.value;
                  setItem((cur) => (cur ? { ...cur, title } : cur));
                  setSaved(false);
                }}
                style={inputStyle}
              />
            </label>

            {item.blocks.map((block, i) => {
              if (block.type === "image") {
                return (
                  <Card key={i} testId={`block-${i}`} style={{ marginTop: space.md }}>
                    <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.sm }}>
                      immagine · asset {block.assetId}
                    </p>
                    <label style={labelStyle}>
                      Testo alternativo
                      <input
                        data-testid={`block-alt-${i}`}
                        value={block.alt}
                        onChange={(e) => patchBlock(i, { alt: e.target.value })}
                        style={inputStyle}
                      />
                    </label>
                    <label style={labelStyle}>
                      Didascalia
                      <input
                        data-testid={`block-caption-${i}`}
                        value={block.caption ?? ""}
                        onChange={(e) => patchBlock(i, { caption: e.target.value })}
                        style={inputStyle}
                      />
                    </label>
                  </Card>
                );
              }
              const blockLabel = block.type === "heading" ? `Titolo H${block.level}` : "Paragrafo";
              return (
                <label key={i} style={labelStyle}>
                  {blockLabel}
                  <textarea
                    data-testid={`block-text-${i}`}
                    value={block.text}
                    rows={block.type === "heading" ? 1 : 3}
                    onChange={(e) => patchBlock(i, { text: e.target.value })}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </label>
              );
            })}

            <div style={{ display: "flex", alignItems: "center", gap: space.md, marginTop: space.lg }}>
              <button
                data-testid="save-button"
                onClick={save}
                disabled={saving}
                style={{
                  fontSize: font.size.md,
                  fontWeight: 600,
                  padding: `${space.sm} ${space.lg}`,
                  borderRadius: radius.sm,
                  border: "none",
                  background: color.accent,
                  color: "#fff",
                  cursor: saving ? "default" : "pointer",
                }}
              >
                {saving ? "Salvataggio…" : "Salva"}
              </button>
              {saved && (
                <span data-testid="save-status" style={{ color: color.approved, fontSize: font.size.sm }}>
                  Salvato
                </span>
              )}

              <span style={{ flex: 1 }} />

              {item.status === "published" ? (
                <span
                  data-testid="publish-status"
                  style={{ color: color.published, fontSize: font.size.sm, fontWeight: 600 }}
                >
                  Pubblicato ✓
                </span>
              ) : (
                <button
                  data-testid="publish-button"
                  onClick={publish}
                  disabled={publishing}
                  style={{
                    fontSize: font.size.md,
                    fontWeight: 600,
                    padding: `${space.sm} ${space.lg}`,
                    borderRadius: radius.sm,
                    border: "none",
                    background: color.published,
                    color: "#fff",
                    cursor: publishing ? "default" : "pointer",
                  }}
                >
                  {publishing ? "Pubblicazione…" : "Pubblica"}
                </button>
              )}
            </div>
          </div>

          <AuthenticityMeter score={meter?.score ?? 0} flags={meter?.flags ?? []} />
        </div>
      )}
    </div>
  );
}
