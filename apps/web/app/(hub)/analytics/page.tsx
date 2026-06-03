"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card, Button, StatCard, SectionTitle, EmptyState } from "../../../src/ui/components";
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

// Mirrors @blogs/contracts NextProposal (feedback loop, Slice 2): the metric-
// derived signal + the adapted next-cycle proposal.
type Weight = "primary" | "secondary" | "deprioritize";
interface ProposalEmphasis {
  channel: string;
  score: number;
  weight: Weight;
}
interface NextProposal {
  signal: { topChannel: string | null };
  proposal: {
    primaryChannel: string | null;
    emphasis: ProposalEmphasis[];
    promptHint: string;
    rationale: string;
  };
}

const WEIGHT_LABEL: Record<Weight, string> = {
  primary: "primario",
  secondary: "secondario",
  deprioritize: "deprioritizzato",
};

const WEIGHT_COLOR: Record<Weight, string> = {
  primary: color.accent,
  secondary: color.info,
  deprioritize: color.textFaint,
};

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
  const [next, setNext] = useState<NextProposal | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dashRes, nextRes] = await Promise.all([
        fetch(`${API}/analytics`),
        fetch(`${API}/feedback/proposal`),
      ]);
      if (!dashRes.ok) {
        setError("Caricamento metriche fallito");
        return;
      }
      setDash((await dashRes.json()) as Dashboard);
      // The feedback proposal is a soft enhancement — don't fail the page on it.
      if (nextRes.ok) setNext((await nextRes.json()) as NextProposal);
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

  // Headline KPIs — turn the flat table into a few scannable numbers up top.
  const channelCount = dash ? new Set(rows.map((r) => r.channel ?? "—")).size : 0;
  const realCount = dash ? dash.bySource.filter((s) => s.kind === "internal").length : 0;
  const stubCount = dash ? dash.bySource.filter((s) => s.kind === "external").length : 0;

  return (
    <div data-testid="surface-analytics">
      <PageHeader
        testId="analytics-header"
        eyebrow="📊 Cross-canale"
        title="Analytics unificata"
        subtitle="Una sola dashboard cross-canale. Le fonti interne (affiliazioni, newsletter, social, contenuti) sono dati reali; GA4 e Search Console sono fonti esterne ancora stubbate al confine (etichettate)."
      />

      <div style={{ display: "flex", alignItems: "center", gap: space.md, marginBottom: space.lg, flexWrap: "wrap" }}>
        <Button testId="analytics-refresh" onClick={refresh} disabled={busy}>
          {busy ? "Aggiornamento…" : "↻ Aggiorna metriche"}
        </Button>
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

      {/* Headline KPIs */}
      {dash && rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: space.md,
            marginBottom: space.lg,
          }}
        >
          <StatCard label="Metriche" value={rows.length} hint="righe cross-canale" accent={color.accent} />
          <StatCard label="Canali" value={channelCount} hint="distinti" accent={color.info} />
          <StatCard label="Fonti reali" value={realCount} hint="dati interni" accent={color.approved} />
          <StatCard label="Fonti stub" value={stubCount} hint="esterne, etichettate" accent={color.textFaint} />
        </div>
      )}

      {/* Feedback loop (Slice 2): the next-cycle proposal adapted from the metrics
          above — the AI proposes what to lean on next; the human still confirms. */}
      {next && (
        <Card testId="feedback-proposal" style={{ marginBottom: space.lg, borderColor: color.accentBorder }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.sm, marginBottom: space.sm, flexWrap: "wrap" }}>
            <span style={{ fontWeight: font.weight.bold, color: color.text }}>
              💡 Prossimo ciclo — cosa propone l’AI
            </span>
            {next.proposal.primaryChannel && (
              <span
                data-testid="feedback-primary-channel"
                style={{
                  fontSize: font.size.sm,
                  fontWeight: font.weight.semibold,
                  padding: `2px ${space.sm}`,
                  borderRadius: radius.pill,
                  background: color.accent,
                  color: "#fff",
                }}
              >
                {next.proposal.primaryChannel}
              </span>
            )}
          </div>
          <p data-testid="feedback-rationale" style={{ margin: `0 0 ${space.sm}`, color: color.textMuted, fontSize: font.size.sm }}>
            {next.proposal.rationale}
          </p>
          {next.proposal.emphasis.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: space.sm }}>
              {next.proposal.emphasis.map((e) => (
                <li
                  key={e.channel}
                  data-testid="feedback-emphasis"
                  data-channel={e.channel}
                  data-weight={e.weight}
                  style={{
                    fontSize: font.size.sm,
                    color: color.textMuted,
                    border: `1px solid ${color.border}`,
                    borderRadius: radius.pill,
                    padding: `2px ${space.sm}`,
                  }}
                >
                  <span style={{ color: WEIGHT_COLOR[e.weight], fontWeight: font.weight.semibold }}>{e.channel}</span> ·{" "}
                  {WEIGHT_LABEL[e.weight]} ({fmt(e.score)})
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {empty && (
        <EmptyState testId="analytics-empty" icon="📊" title="Ancora nessuna metrica">
          Premi “Aggiorna metriche” per fare l’ingest cross-canale.
        </EmptyState>
      )}

      {/* Per-source rollup cards: each source labelled real (internal) or stub (external). */}
      {dash && dash.bySource.length > 0 && (
        <>
          <SectionTitle>Per fonte</SectionTitle>
          <div
            data-testid="analytics-sources"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: space.md, marginBottom: space.xl }}
          >
            {dash.bySource.map((s) => (
              <Card key={s.source} testId={`analytics-source-${s.source}`}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                  <span style={{ fontWeight: font.weight.bold, color: color.text, textTransform: "capitalize" }}>
                    {s.source.replace(/_/g, " ")}
                  </span>
                  <span
                    data-testid={`analytics-kind-${s.source}`}
                    style={{
                      fontSize: font.size.xs,
                      fontWeight: font.weight.semibold,
                      padding: `2px 10px`,
                      borderRadius: radius.pill,
                      background: s.kind === "external" ? color.surfaceSunken : `${color.published}1a`,
                      color: s.kind === "external" ? color.textMuted : color.published,
                      border: `1px solid ${s.kind === "external" ? color.border : color.published + "55"}`,
                    }}
                  >
                    {s.kind === "external" ? "stub" : "reale"}
                  </span>
                </div>
                <ul style={{ listStyle: "none", margin: `${space.md} 0 0`, padding: 0, display: "grid", gap: space.xs }}>
                  {s.metrics.map((m) => (
                    <li key={m.metric} style={{ display: "flex", justifyContent: "space-between", color: color.textMuted, fontSize: font.size.sm }}>
                      <span>{metricLabel(m.metric)}</span>
                      <span style={{ fontWeight: font.weight.semibold, color: color.text }}>{fmt(m.value)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Flat cross-channel table — the unified model, every (source · channel · metric). */}
      {rows.length > 0 && (
        <>
          <SectionTitle>Tutte le metriche</SectionTitle>
          <Card testId="analytics-table" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.sm }}>
                <thead>
                  <tr style={{ textAlign: "left", color: color.textMuted, background: color.surfaceMuted }}>
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
                      style={{ background: i % 2 ? color.surfaceMuted + "80" : "transparent" }}
                    >
                      <td style={tdStyle}>
                        <span style={{ color: color.text, fontWeight: font.weight.medium, textTransform: "capitalize" }}>
                          {r.source.replace(/_/g, " ")}
                        </span>
                        {r.kind === "external" && (
                          <span style={{ marginLeft: space.xs, color: color.textFaint, fontSize: font.size.xs }}>(stub)</span>
                        )}
                      </td>
                      <td style={tdStyle}>{r.channel ?? "unattributed"}</td>
                      <td style={tdStyle}>{metricLabel(r.metric)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: font.weight.bold, color: color.text }}>{fmt(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

const thStyle = {
  padding: `${space.sm} ${space.md}`,
  borderBottom: `1px solid ${color.border}`,
  fontWeight: 600,
  fontSize: font.size.xs,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  position: "sticky" as const,
  top: 0,
} as const;

const tdStyle = {
  padding: `${space.sm} ${space.md}`,
  borderBottom: `1px solid ${color.border}`,
  color: color.textMuted,
} as const;
