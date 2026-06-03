"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card, EmptyState } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface ChannelConnection {
  channel: string;
  connected: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  x: "X (Twitter)",
  pinterest: "Pinterest",
};

/**
 * "Canali" surface (Step B): connect/disconnect a social channel from the Hub.
 * The connection state is real (sealed, per-tenant credential store); the
 * provider consent/handshake is stubbed at the boundary (DEBT-008) — the UI is
 * already the real onboarding control, ready for the real Meta flow.
 */
export default function ChannelsSurface() {
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/channels`);
      if (!res.ok) throw new Error("load failed");
      setChannels((await res.json()).channels as ChannelConnection[]);
    } catch {
      setError("Caricamento canali fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (channel: string, connect: boolean) => {
    setBusy(channel);
    setError(null);
    try {
      const action = connect ? "connect" : "disconnect";
      const res = await fetch(`${API}/channels/${channel}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("toggle failed");
      const updated = (await res.json()) as ChannelConnection;
      setChannels((cur) => cur.map((c) => (c.channel === updated.channel ? updated : c)));
    } catch {
      setError(connect ? "Connessione fallita" : "Disconnessione fallita");
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div data-testid="surface-channels">
      <PageHeader
        testId="channels-header"
        title="Canali"
        subtitle="Collega i tuoi account social per pubblicare e gestire da qui. (Collegamento dimostrativo: il consenso reale del provider arriva con l'app Meta.)"
      />

      {error && (
        <p data-testid="channels-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {loaded && channels.length === 0 && !error && (
        <EmptyState testId="channels-empty" icon="🔌" title="Nessun canale disponibile" />
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.md }}>
        {channels.map((c) => (
          <li
            key={c.channel}
            data-testid="channel-item"
            data-channel={c.channel}
            data-connected={c.connected}
          >
            <Card
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.md,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: space.md }}>
                <span style={{ fontWeight: 600, color: color.text }}>
                  {CHANNEL_LABEL[c.channel] ?? c.channel}
                </span>
                <span
                  data-testid="channel-status"
                  style={{
                    fontSize: font.size.sm,
                    fontWeight: 600,
                    color: c.connected ? color.approved : color.textMuted,
                  }}
                >
                  {c.connected ? "Connesso ✓" : "Non connesso"}
                </span>
              </span>
              {c.connected ? (
                <button
                  data-testid="channel-disconnect"
                  onClick={() => toggle(c.channel, false)}
                  disabled={busy === c.channel}
                  style={secondaryBtn(busy === c.channel)}
                >
                  {busy === c.channel ? "…" : "Disconnetti"}
                </button>
              ) : (
                <button
                  data-testid="channel-connect"
                  onClick={() => toggle(c.channel, true)}
                  disabled={busy === c.channel}
                  style={primaryBtn(busy === c.channel)}
                >
                  {busy === c.channel ? "Connetto…" : "Connetti"}
                </button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

const btnBase = {
  fontSize: font.size.sm,
  fontWeight: 600,
  padding: `${space.xs} ${space.md}`,
  borderRadius: radius.sm,
  cursor: "pointer" as const,
};

function primaryBtn(disabled: boolean) {
  return {
    ...btnBase,
    border: "none",
    background: disabled ? color.border : color.accent,
    color: "#fff",
    cursor: disabled ? ("default" as const) : ("pointer" as const),
  };
}

function secondaryBtn(disabled: boolean) {
  return {
    ...btnBase,
    background: color.surfaceMuted,
    color: color.text,
    border: `1px solid ${color.border}`,
    opacity: disabled ? 0.6 : 1,
  };
}
