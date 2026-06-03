"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card, StateBadge, Toolbar, EmptyState, type PublicationStatus } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// The canonical content types today (see modules/content ContentType). Kept in
// one place so the filter and any later surface read the same vocabulary.
const TYPES = ["article", "itinerary"] as const;
const STATUSES: PublicationStatus[] = ["draft", "proposed", "review", "approved", "published"];

interface ContentListItem {
  id: string;
  type: string;
  status: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string;
}

/**
 * Stable URL contract toward the (slice-2) Block Editor: a content item is
 * edited at `/editor?id=<id>`. Slice 2 reads `id` from the query string.
 */
function editorHref(id: string): string {
  return `/editor?id=${id}`;
}

export default function LibrarySurface() {
  const [items, setItems] = useState<ContentListItem[]>([]);
  const [type, setType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams();
    if (type) qs.set("type", type);
    if (status) qs.set("status", status);
    const suffix = qs.toString() ? `?${qs}` : "";
    try {
      const res = await fetch(`${API}/articles${suffix}`);
      if (!res.ok) {
        setError("Caricamento contenuti fallito");
        return;
      }
      setItems((await res.json()).items as ContentListItem[]);
    } catch {
      setError("Caricamento contenuti fallito");
    } finally {
      setLoaded(true);
    }
  }, [type, status]);

  // Re-fetch with the active filters whenever they change (the list endpoint
  // applies `type`/`status` server-side under the tenant guard + RLS).
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div data-testid="surface-library">
      <PageHeader
        testId="library-header"
        title="Library"
        subtitle="Tutti i contenuti, filtrabili, con il badge di stato dalla macchina a stati di pubblicazione."
      />

      <Toolbar>
        <label style={{ fontSize: font.size.sm, color: color.textMuted, display: "inline-flex", alignItems: "center", gap: space.xs }}>
          Tipo{" "}
          <select
            data-testid="filter-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={selectStyle}
          >
            <option value="">Tutti</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: font.size.sm, color: color.textMuted, display: "inline-flex", alignItems: "center", gap: space.xs }}>
          Stato{" "}
          <select
            data-testid="filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={selectStyle}
          >
            <option value="">Tutti</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </Toolbar>

      {error && (
        <p data-testid="library-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {loaded && items.length === 0 && !error && (
        <EmptyState testId="library-empty" icon="📚" title="Nessun contenuto per questi filtri">
          Cambia i filtri qui sopra, o genera un nuovo contenuto dalla Proposal Queue.
        </EmptyState>
      )}

      <ul
        data-testid="library-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.md }}
      >
        {items.map((item) => (
          <li key={item.id} data-testid="library-item" data-type={item.type} data-status={item.status}>
            <Link href={editorHref(item.id)} style={{ textDecoration: "none", color: "inherit" }}>
              <Card interactive style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md, padding: `${space.md} ${space.lg}` }}>
                <span style={{ display: "flex", alignItems: "center", gap: space.md, minWidth: 0 }}>
                  <span style={typeChip}>{item.type}</span>
                  <span style={{ fontWeight: 600, color: color.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: space.md, flexShrink: 0 }}>
                  <StateBadge status={item.status as PublicationStatus} />
                  <span aria-hidden style={{ color: color.textFaint }}>→</span>
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const selectStyle = {
  fontSize: font.size.sm,
  padding: `5px ${space.sm}`,
  borderRadius: radius.sm,
  border: `1px solid ${color.borderStrong}`,
  background: color.surface,
  color: color.text,
};

const typeChip = {
  flexShrink: 0,
  fontSize: font.size.xs,
  fontWeight: font.weight.semibold,
  color: color.textMuted,
  background: color.surfaceMuted,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  padding: `2px 8px`,
  textTransform: "capitalize" as const,
} as const;
