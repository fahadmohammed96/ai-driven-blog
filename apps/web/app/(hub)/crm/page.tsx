"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Mirrors @blogs/contracts LeadView. apps/web doesn't depend on the contracts
// package (the other surfaces inline their types too).
interface Lead {
  id: string;
  customerEmail: string;
  customerName: string | null;
  request: string;
  status: string;
  proposal: string | null;
  depositCents: number | null;
  currency: string;
  paymentRef: string | null;
  portalToken: string;
}

/**
 * CRM surface (Fase 3, motion "Su misura" — INBOUND). The custom-request inbox:
 * an inbound lead enters, the AI drafts a proposal, the founder APPROVES it (the
 * human-in-the-loop gate — nothing reaches the client before approval), the
 * deposit is collected and the confirmed itinerary is delivered to the client
 * portal. Thin by design — the pipeline + state machine live in the API.
 */
export default function CrmSurface() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [request, setRequest] = useState("");
  const [deposits, setDeposits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/leads`);
      if (!res.ok) {
        setError("Caricamento richieste fallito");
        return;
      }
      setLeads((await res.json()).leads as Lead[]);
    } catch {
      setError("Caricamento richieste fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(url: string, body?: unknown) {
    const res = await fetch(`${API}${url}`, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      setError("Azione fallita.");
      return;
    }
    await load();
  }

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  async function createLead() {
    const customerEmail = email.trim();
    if (!customerEmail || !request.trim()) return;
    await run("new", async () => {
      await act("/leads", { customerEmail, request: request.trim() });
      setEmail("");
      setRequest("");
    });
  }

  return (
    <div data-testid="surface-crm">
      <PageHeader
        testId="crm-header"
        title="Richieste su misura"
        subtitle="L'AI propone, tu confermi: rivedi e approva la proposta prima che venga inviata al cliente. Poi acconto e consegna nel portale."
      />

      {error && (
        <p data-testid="crm-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      <Card testId="crm-new">
        <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap", alignItems: "center" }}>
          <input
            data-testid="lead-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email cliente"
            style={inputStyle}
          />
          <input
            data-testid="lead-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="richiesta del cliente"
            style={{ ...inputStyle, flex: 1, minWidth: 240 }}
          />
          <button
            data-testid="lead-create"
            onClick={createLead}
            disabled={busy === "new" || !email.trim() || !request.trim()}
            style={buttonStyle(busy !== "new" && Boolean(email.trim()) && Boolean(request.trim()))}
          >
            Apri richiesta
          </button>
        </div>
      </Card>

      {loaded && leads.length === 0 && !error && (
        <Card testId="crm-empty">
          <p style={{ margin: 0, color: color.textMuted }}>Ancora nessuna richiesta su misura.</p>
        </Card>
      )}

      <ul
        data-testid="crm-list"
        style={{ listStyle: "none", margin: `${space.lg} 0 0`, padding: 0, display: "grid", gap: space.lg }}
      >
        {leads.map((l) => (
          <li key={l.id} data-testid="lead-item" data-lead-id={l.id}>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: space.md }}>
                <span style={{ fontWeight: 600, color: color.text }}>{l.customerEmail}</span>
                <span
                  data-testid="lead-status"
                  data-status={l.status}
                  style={{ color: color.textMuted, fontSize: font.size.sm }}
                >
                  {l.status}
                </span>
              </div>
              <p style={{ margin: `${space.sm} 0 0`, color: color.textMuted, fontSize: font.size.sm }}>{l.request}</p>

              {l.proposal && (
                <p
                  data-testid="lead-proposal"
                  style={{
                    margin: `${space.md} 0 0`,
                    padding: space.md,
                    background: color.surface,
                    borderRadius: radius.sm,
                    color: color.text,
                    fontSize: font.size.sm,
                  }}
                >
                  {l.proposal}
                </p>
              )}

              <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap", marginTop: space.md }}>
                {l.status === "received" && (
                  <>
                    <input
                      data-testid="draft-deposit"
                      value={deposits[l.id] ?? ""}
                      onChange={(e) => setDeposits((d) => ({ ...d, [l.id]: e.target.value }))}
                      placeholder="acconto (cent)"
                      style={inputStyle}
                    />
                    <button
                      data-testid="draft-submit"
                      onClick={() =>
                        run(l.id, () =>
                          act(`/leads/${l.id}/draft`, {
                            depositCents: Number(deposits[l.id] ?? "0") || 0,
                          }),
                        )
                      }
                      disabled={busy === l.id || !(Number(deposits[l.id] ?? "0") > 0)}
                      style={buttonStyle(busy !== l.id && Number(deposits[l.id] ?? "0") > 0)}
                    >
                      Bozza AI
                    </button>
                  </>
                )}

                {l.status === "ai_drafted" && (
                  <>
                    <button
                      data-testid="approve-submit"
                      onClick={() => run(l.id, () => act(`/leads/${l.id}/approve`))}
                      disabled={busy === l.id}
                      style={buttonStyle(busy !== l.id)}
                    >
                      Approva e invia
                    </button>
                    <button
                      data-testid="reject-submit"
                      onClick={() => run(l.id, () => act(`/leads/${l.id}/reject`))}
                      disabled={busy === l.id}
                      style={ghostButtonStyle(busy !== l.id)}
                    >
                      Rifiuta
                    </button>
                  </>
                )}

                {l.status === "sent" && (
                  <button
                    data-testid="deposit-submit"
                    onClick={() => run(l.id, () => act(`/leads/${l.id}/deposit`))}
                    disabled={busy === l.id}
                    style={buttonStyle(busy !== l.id)}
                  >
                    Versa acconto
                  </button>
                )}

                {l.status === "confirmed" && (
                  <button
                    data-testid="deliver-submit"
                    onClick={() => run(l.id, () => act(`/leads/${l.id}/deliver`))}
                    disabled={busy === l.id}
                    style={buttonStyle(busy !== l.id)}
                  >
                    Consegna itinerario
                  </button>
                )}

                {l.status === "delivered" && (
                  <span data-testid="portal-link" data-token={l.portalToken} style={{ color: color.textMuted, fontSize: font.size.sm }}>
                    Consegnato · /portal/{l.portalToken}
                  </span>
                )}
                {l.paymentRef && (
                  <span data-testid="payment-ref" style={{ color: color.textMuted, fontSize: font.size.sm }}>
                    {l.paymentRef}
                  </span>
                )}
              </div>
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

function ghostButtonStyle(enabled: boolean) {
  return {
    fontSize: font.size.md,
    fontWeight: 600,
    padding: `${space.sm} ${space.lg}`,
    borderRadius: radius.sm,
    border: `1px solid ${color.border}`,
    background: "transparent",
    color: color.text,
    cursor: enabled ? "pointer" : "default",
  };
}
