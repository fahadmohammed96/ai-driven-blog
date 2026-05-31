"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Mirrors @blogs/contracts AnalyticsDashboard. apps/web doesn't depend on the
// contracts package (the other surfaces inline their types too), so we restate
// the shapes here.
type Kind = "internal" | "external";
interface MetricRow {
  source: string;
  kind: Kind;
  channel: string | null;
  metric: string;
  value: number;
  period: string;
  contentItemId: string | null;
}
interface SourceRollup {
  source: string;
  kind: Kind;
  metrics: { metric: string; value: number }[];
}
interface ChannelRollup {
  channel: string;
  metrics: { source: string; metric: string; value: number }[];
}
interface Dashboard {
  rows: MetricRow[];
  bySource: SourceRollup[];
  byChannel: ChannelRollup[];
  ingestedAt: string | null;
}

/** Human label for a metric key (kept lightweight — the source of truth is the API). */
function metricLabel(metric: string): string {
  return metric.replace(/_/g, " ");
}

/** Pretty number: integers plain, decimals (e.g. avg position) to 1dp. */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function AnalyticsSurface() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/analytics`);
      if (!res.ok) {
        setError("Caricamento metriche fallito");
        return;
      }
      setDash((await res.json()) as Dashboard);
    } catch {
      setError("Caricamento metriche fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Run ingestion across all sources (internal real + external stubbed), then reload.
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/analytics/ingest`, { method: "POST" });
      if (!res.ok) {
        setError("Aggiornamento metriche fallito");
        return;
      }
      await load();
    } catch {
      setError("Aggiornamento metriche fallito");
    } finally {
      setBusy(false);
    }
  }

  const rows = dash?.rows ?? [];
  const empty = loaded && rows.length === 0 && !error;

  return (
    <div data-testid="surface-analytics">
      <PageHeader
        testId="analytics-header"
        title="Analytics unificata"
        subtitle="Una sola dashboard cross-canale. Le fonti interne (affiliazioni, newsletter, social, contenuti) sono dati reali; GA4 e Search Console sono fonti esterne ancora stubbate al confine (etichettate)."
      />

      <div style={{ display: "flex", alignItems: "center", gap: space.md, marginBottom: space.lg }}>
        <button
          data-testid="analytics-refresh"
          onClick={refresh}
          disabled={busy}
          style={{
            fontSize: font.size.md,
            fontWeight: 600,
            padding: `${space.sm} ${space.lg}`,
            borderRadius: radius.sm,
            border: "none",
            background: busy ? color.border : color.accent,
            color: "#fff",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Aggiornamento…" : "Aggiorna metriche"}
        </button>
        {dash?.ingestedAt && (
          <span data-testid="analytics-ingested-at" style={{ color: color.textMuted, fontSize: font.size.sm }}>
            Ultimo aggiornamento: {new Date(dash.ingestedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <p data-testid="analytics-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {empty && (
        <Card testId="analytics-empty">
          <p style={{ margin: 0, color: color.textMuted }}>
            Ancora nessuna metrica. Premi “Aggiorna metriche” per fare l’ingest cross-canale.
          </p>
        </Card>
      )}

      {/* Per-source rollup cards: each source labelled real (internal) or stub (external). */}
      {dash && dash.bySource.length > 0 && (
        <div
          data-testid="analytics-sources"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: space.md, marginBottom: space.lg }}
        >
          {dash.bySource.map((s) => (
            <Card key={s.source} testId={`analytics-source-${s.source}`}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                <span style={{ fontWeight: 700, color: color.text, textTransform: "capitalize" }}>
                  {s.source.replace(/_/g, " ")}
                </span>
                <span
                  data-testid={`analytics-kind-${s.source}`}
                  style={{
                    fontSize: font.size.sm,
                    fontWeight: 600,
                    padding: `2px ${space.sm}`,
                    borderRadius: radius.sm,
                    background: s.kind === "external" ? color.border : color.published,
                    color: s.kind === "external" ? color.textMuted : "#fff",
                  }}
                >
                  {s.kind === "external" ? "stub" : "reale"}
                </span>
              </div>
              <ul style={{ listStyle: "none", margin: `${space.sm} 0 0`, padding: 0 }}>
                {s.metrics.map((m) => (
                  <li key={m.metric} style={{ display: "flex", justifyContent: "space-between", color: color.textMuted, fontSize: font.size.sm }}>
                    <span>{metricLabel(m.metric)}</span>
                    <span style={{ fontWeight: 600, color: color.text }}>{fmt(m.value)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* Flat cross-channel table — the unified model, every (source · channel · metric). */}
      {rows.length > 0 && (
        <Card testId="analytics-table">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.sm }}>
            <thead>
              <tr style={{ textAlign: "left", color: color.textMuted }}>
                <th style={thStyle}>Fonte</th>
                <th style={thStyle}>Canale</th>
                <th style={thStyle}>Metrica</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Valore</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.source}-${r.channel}-${r.metric}-${i}`}
                  data-testid="analytics-metric-row"
                  data-source={r.source}
                  data-kind={r.kind}
                  data-channel={r.channel ?? "unattributed"}
                  data-metric={r.metric}
                >
                  <td style={tdStyle}>
                    <span style={{ color: color.text }}>{r.source.replace(/_/g, " ")}</span>
                    {r.kind === "external" && (
                      <span style={{ marginLeft: space.xs, color: color.textMuted, fontSize: font.size.sm }}>(stub)</span>
                    )}
                  </td>
                  <td style={tdStyle}>{r.channel ?? "unattributed"}</td>
                  <td style={tdStyle}>{metricLabel(r.metric)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: color.text }}>{fmt(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

const thStyle = {
  padding: space.sm,
  borderBottom: `1px solid ${color.border}`,
  fontWeight: 600,
} as const;

const tdStyle = {
  padding: space.sm,
  borderBottom: `1px solid ${color.border}`,
  color: color.textMuted,
} as const;
