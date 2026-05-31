"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Mirrors @blogs/contracts AffiliateLinkView. apps/web doesn't depend on the
// contracts package (the other surfaces inline their types too), so we restate
// the shape here. If a slice wires the FE to contracts, swap for the import.
interface AffiliateLink {
  id: string;
  code: string;
  targetUrl: string;
  contentItemId: string | null;
  channel: string | null;
  label: string | null;
  createdAt: string;
  clicks: number;
}

/** The public redirector URL for a code — what you paste into a post/article. */
function goUrl(code: string): string {
  return `${API}/go/${code}`;
}

export default function AffiliatesSurface() {
  const [links, setLinks] = useState<AffiliateLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-link form state.
  const [code, setCode] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [channel, setChannel] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/affiliates`);
      if (!res.ok) {
        setError("Caricamento link fallito");
        return;
      }
      setLinks((await res.json()).links as AffiliateLink[]);
    } catch {
      setError("Caricamento link fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = { code, targetUrl };
      if (channel.trim()) body.channel = channel.trim();
      if (label.trim()) body.label = label.trim();
      const res = await fetch(`${API}/affiliates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        setError("Esiste già un link con questo code.");
        return;
      }
      if (!res.ok) {
        setError("Creazione link fallita (controlla code e URL).");
        return;
      }
      setCode("");
      setTargetUrl("");
      setChannel("");
      setLabel("");
      await load();
    } catch {
      setError("Creazione link fallita.");
    } finally {
      setSaving(false);
    }
  }

  const canCreate = code.trim().length > 0 && targetUrl.trim().length > 0 && !saving;

  return (
    <div data-testid="surface-affiliates">
      <PageHeader
        testId="affiliates-header"
        title="Affiliate hub"
        subtitle="Crea link tracciati e conta i click. Il redirector /go/:code registra ogni click (link · articolo · canale) e reindirizza al target."
      />

      {error && (
        <p data-testid="affiliates-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {/* Create a new tracked link. */}
      <Card testId="affiliate-create" style={{ marginBottom: space.lg }}>
        <h2 style={{ fontSize: font.size.lg, margin: 0, color: color.text }}>Nuovo link</h2>
        <div style={{ display: "grid", gap: space.sm, marginTop: space.md, maxWidth: 560 }}>
          <label style={labelStyle}>
            Code (slug per /go/)
            <input
              data-testid="affiliate-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="es. hotel-tokyo"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Target URL
            <input
              data-testid="affiliate-target"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://partner.example.com/..."
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Canale (facoltativo)
            <input
              data-testid="affiliate-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="es. blog, newsletter, instagram"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Etichetta (facoltativa)
            <input
              data-testid="affiliate-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={inputStyle}
            />
          </label>
          <div>
            <button
              data-testid="affiliate-create-submit"
              onClick={create}
              disabled={!canCreate}
              style={{
                fontSize: font.size.md,
                fontWeight: 600,
                padding: `${space.sm} ${space.lg}`,
                borderRadius: radius.sm,
                border: "none",
                background: canCreate ? color.accent : color.border,
                color: "#fff",
                cursor: canCreate ? "pointer" : "default",
              }}
            >
              {saving ? "Creazione…" : "Crea link"}
            </button>
          </div>
        </div>
      </Card>

      {loaded && links.length === 0 && !error && (
        <Card testId="affiliates-empty">
          <p style={{ margin: 0, color: color.textMuted }}>Ancora nessun link. Creane uno qui sopra.</p>
        </Card>
      )}

      <ul
        data-testid="affiliates-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.md }}
      >
        {links.map((l) => (
          <li key={l.id} data-testid="affiliate-item" data-code={l.code}>
            <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: color.text }}>{l.label ?? l.code}</span>
                {l.channel && (
                  <span style={{ marginLeft: space.sm, color: color.textMuted, fontSize: font.size.sm }}>
                    {l.channel}
                  </span>
                )}
                <span
                  style={{
                    display: "block",
                    color: color.textMuted,
                    fontSize: font.size.sm,
                    marginTop: space.xs,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <a href={goUrl(l.code)} style={{ color: color.accent }}>
                    /go/{l.code}
                  </a>{" "}
                  → {l.targetUrl}
                </span>
              </span>
              <span
                data-testid="affiliate-clicks"
                title="Click totali"
                style={{
                  flexShrink: 0,
                  fontWeight: 700,
                  fontSize: font.size.lg,
                  color: color.published,
                }}
              >
                {l.clicks}
                <span style={{ fontSize: font.size.sm, color: color.textMuted, fontWeight: 400 }}> click</span>
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
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
};
