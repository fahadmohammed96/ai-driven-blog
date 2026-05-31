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

/** Edit a proposal = open it in the slice-2 Block Editor (same URL contract). */
function editorHref(id: string): string {
  return `/editor?id=${id}`;
}

export default function ProposalsSurface() {
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
  }, [load]);

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
