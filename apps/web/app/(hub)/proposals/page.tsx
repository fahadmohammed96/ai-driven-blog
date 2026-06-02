"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card, StateBadge, type PublicationStatus } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// The Proposal Queue surfaces the universal gesture "specialist proposes →
// human approves / edits / rejects" (ADR-0020) over the existing publish state
// machine. Items AWAITING a human decision are those in `proposed` or `review`;
// approve walks them to `approved`, reject sends them back to `draft`. Both
// reuse the real transition endpoints (POST /articles/:id/{approve,reject}).
const AWAITING: PublicationStatus[] = ["proposed", "review"];

interface ProposalItem {
  id: string;
  type: string;
  status: string;
  title: string;
}

/** The Researcher's ephemeral brief, surfaced for transparency (Slice X1). */
interface ResearchContext {
  facts: string[];
  sources: { title: string; url: string }[];
  keyInsights: string[];
  gapsToFill: string[];
  rationale: string;
}

/** A staged AI-agent proposal (Slice T1): cost + reasoning + definition version. */
interface AgentProposal {
  id: string;
  agentName: string;
  type: string;
  status: string;
  estimatedCostUsd: number;
  agentDefinitionVersion: string;
  rationale: string;
  title: string;
  draftPreview: string;
  reasoning: { name: string; input: unknown }[];
  /** Present only when the external-research flag was on (Slice X1). */
  researchContext: ResearchContext | null;
}

/** Edit a proposal = open it in the slice-2 Block Editor (same URL contract). */
function editorHref(id: string): string {
  return `/editor?id=${id}`;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function ProposalsSurface() {
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Slice T1 — staged AI-agent proposals + the tenant's residual monthly budget.
  const [agentItems, setAgentItems] = useState<AgentProposal[]>([]);
  const [budgetResiduo, setBudgetResiduo] = useState<number | null>(null);
  const [agentBusy, setAgentBusy] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/agent-proposals`);
      if (!res.ok) throw new Error("load failed");
      const body = await res.json();
      setAgentItems(body.proposals as AgentProposal[]);
      setBudgetResiduo(body.tenantBudgetResiduoUsd as number);
    } catch {
      setError("Caricamento proposte agenti fallito");
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      // One fetch per awaiting status (the list endpoint takes a single status);
      // merge so the queue shows everything pending a decision.
      const lists = await Promise.all(
        AWAITING.map(async (status) => {
          const res = await fetch(`${API}/articles?status=${status}`);
          if (!res.ok) throw new Error("load failed");
          return (await res.json()).items as ProposalItem[];
        }),
      );
      setItems(lists.flat());
    } catch {
      setError("Caricamento proposte fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadAgents();
  }, [load, loadAgents]);

  const decideAgent = useCallback(
    async (id: string, action: "approve" | "reject") => {
      setAgentBusy(id);
      setError(null);
      try {
        const res = await fetch(`${API}/agent-proposals/${id}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error("decision failed");
        // Approve consumes the proposal into the Phase-1 state machine (draft →
        // review): reload BOTH queues so the new item shows in the publish queue.
        await Promise.all([loadAgents(), load()]);
      } catch {
        setError("Azione agente fallita");
      } finally {
        setAgentBusy(null);
      }
    },
    [loadAgents, load],
  );

  const decide = useCallback(
    async (id: string, action: "approve" | "reject") => {
      setBusy(id);
      setError(null);
      try {
        const res = await fetch(`${API}/articles/${id}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error("decision failed");
        // On success the item leaves the awaiting set → reload the queue so it
        // reflects the real, persisted state (it drops out of proposed/review).
        await load();
      } catch {
        setError("Azione fallita");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <div data-testid="surface-proposals">
      <PageHeader
        testId="proposals-header"
        title="Proposal Queue"
        subtitle="Il gesto propose→approve: le proposte degli specialisti AI che approvi, modifichi o rifiuti."
      />

      {error && (
        <p data-testid="proposals-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {/* Slice T1 — staged AI-agent proposals: cost + residual budget + the
          agent's reasoning, approved into the same publish state machine. */}
      <section data-testid="surface-agent-proposals" style={{ marginBottom: space.lg }}>
        <h2 style={{ fontSize: font.size.lg, color: color.text, margin: `0 0 ${space.sm}` }}>
          Proposte degli agenti
        </h2>
        {budgetResiduo !== null && (
          <p
            data-testid="agent-budget-residuo"
            style={{ margin: `0 0 ${space.md}`, color: color.textMuted, fontSize: font.size.sm }}
          >
            Budget residuo del mese: <strong>{usd(budgetResiduo)}</strong>
          </p>
        )}

        {agentItems.length === 0 ? (
          <Card testId="agent-proposals-empty">
            <p style={{ margin: 0, color: color.textMuted }}>
              Nessuna proposta degli agenti in attesa.
            </p>
          </Card>
        ) : (
          <ul
            data-testid="agent-proposals-list"
            style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.md }}
          >
            {agentItems.map((p) => (
              <li key={p.id} data-testid="agent-proposal-item" data-id={p.id} data-status={p.status}>
                <Card style={{ display: "grid", gap: space.sm }}>
                  <span style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: color.text }}>{p.title}</span>
                    <span style={{ color: color.textMuted, fontSize: font.size.sm }}>
                      {p.agentName} · {p.type}
                    </span>
                    <span
                      data-testid="agent-proposal-version"
                      style={{ color: color.textMuted, fontSize: font.size.sm }}
                    >
                      v: {p.agentDefinitionVersion}
                    </span>
                  </span>

                  <span style={{ display: "flex", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
                    <span data-testid="agent-proposal-cost" style={{ fontSize: font.size.sm, color: color.text }}>
                      Costo stimato: <strong>{usd(p.estimatedCostUsd)}</strong>
                    </span>
                  </span>

                  <details data-testid="agent-proposal-reasoning">
                    <summary style={{ cursor: "pointer", fontSize: font.size.sm, color: color.textMuted }}>
                      Ragionamento agente
                    </summary>
                    <p style={{ margin: `${space.xs} 0 0`, color: color.textMuted, fontSize: font.size.sm }}>
                      {p.rationale}
                    </p>
                    {p.reasoning.length > 0 && (
                      <ul style={{ margin: `${space.xs} 0 0`, paddingLeft: "1.25rem" }}>
                        {p.reasoning.map((r, i) => (
                          <li key={i} style={{ color: color.textMuted, fontSize: font.size.sm }}>
                            {r.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>

                  {/* Slice X1 — "Fonti usate dal Ricercatore": shown only when the
                      external-research flag enriched this proposal (critica #14). */}
                  {p.researchContext &&
                    (p.researchContext.facts.length > 0 || p.researchContext.sources.length > 0) && (
                      <details data-testid="agent-proposal-research">
                        <summary style={{ cursor: "pointer", fontSize: font.size.sm, color: color.textMuted }}>
                          Fonti usate dal Ricercatore
                        </summary>
                        {p.researchContext.facts.length > 0 && (
                          <ul style={{ margin: `${space.xs} 0 0`, paddingLeft: "1.25rem" }}>
                            {p.researchContext.facts.map((f, i) => (
                              <li key={i} style={{ color: color.textMuted, fontSize: font.size.sm }}>
                                {f}
                              </li>
                            ))}
                          </ul>
                        )}
                        {p.researchContext.sources.length > 0 && (
                          <ul style={{ margin: `${space.xs} 0 0`, paddingLeft: "1.25rem" }}>
                            {p.researchContext.sources.map((s, i) => (
                              <li key={i} style={{ color: color.textMuted, fontSize: font.size.sm }}>
                                <a href={s.url} target="_blank" rel="noreferrer">
                                  {s.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    )}

                  <span style={{ display: "flex", alignItems: "center", gap: space.sm }}>
                    <button
                      data-testid="agent-proposal-approve"
                      onClick={() => decideAgent(p.id, "approve")}
                      disabled={agentBusy === p.id}
                      style={primaryButton(agentBusy === p.id)}
                    >
                      Approva
                    </button>
                    <button
                      data-testid="agent-proposal-reject"
                      onClick={() => decideAgent(p.id, "reject")}
                      disabled={agentBusy === p.id}
                      style={dangerButton(agentBusy === p.id)}
                    >
                      Rifiuta
                    </button>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loaded && items.length === 0 && !error && (
        <Card testId="proposals-empty">
          <p style={{ margin: 0, color: color.textMuted }}>
            Nessuna proposta in attesa di una decisione.
          </p>
        </Card>
      )}

      <ul
        data-testid="proposals-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.md }}
      >
        {items.map((item) => (
          <li
            key={item.id}
            data-testid="proposal-item"
            data-id={item.id}
            data-status={item.status}
          >
            <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <span style={{ display: "flex", alignItems: "center", gap: space.md, minWidth: 0 }}>
                <StateBadge status={item.status as PublicationStatus} />
                <span style={{ fontWeight: 600, color: color.text, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.title}
                </span>
                <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{item.type}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: space.sm, flexShrink: 0 }}>
                <button
                  data-testid="proposal-approve"
                  onClick={() => decide(item.id, "approve")}
                  disabled={busy === item.id}
                  style={primaryButton(busy === item.id)}
                >
                  Approva
                </button>
                <button
                  data-testid="proposal-reject"
                  onClick={() => decide(item.id, "reject")}
                  disabled={busy === item.id}
                  style={dangerButton(busy === item.id)}
                >
                  Rifiuta
                </button>
                <Link data-testid="proposal-edit" href={editorHref(item.id)} style={linkButton}>
                  Modifica
                </Link>
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

const buttonBase = {
  fontSize: font.size.sm,
  fontWeight: 600,
  padding: `${space.xs} ${space.md}`,
  borderRadius: radius.sm,
  border: "none",
  textDecoration: "none",
} as const;

function primaryButton(disabled: boolean) {
  return {
    ...buttonBase,
    background: color.approved,
    color: "#fff",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function dangerButton(disabled: boolean) {
  return {
    ...buttonBase,
    background: color.danger,
    color: "#fff",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

const linkButton = {
  ...buttonBase,
  background: color.surfaceMuted,
  color: color.text,
  border: `1px solid ${color.border}`,
  display: "inline-block",
  cursor: "pointer",
} as const;
