"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Settings shape mirrors @blogs/contracts TenantSettings. apps/web doesn't depend
// on the contracts package (the other surfaces inline their types too), so we
// restate it here. If a slice wires the FE to contracts, swap for the import.
type AutonomyLevel = "manual" | "semi-auto" | "auto-within-limits";
type Channel = "instagram" | "x" | "pinterest";

interface TenantSettings {
  brandVoice: { tone: string; audience: string };
  specialistAutonomy: Record<"writer" | "seo" | "social" | "email", AutonomyLevel>;
  channels: { channel: Channel; enabled: boolean }[];
}

const SPECIALISTS: { key: keyof TenantSettings["specialistAutonomy"]; label: string }[] = [
  { key: "writer", label: "Scrittore" },
  { key: "seo", label: "SEO" },
  { key: "social", label: "Social" },
  { key: "email", label: "Email" },
];

const AUTONOMY_OPTIONS: { value: AutonomyLevel; label: string }[] = [
  { value: "manual", label: "Manuale (rivedi tutto)" },
  { value: "semi-auto", label: "Semi-automatico" },
  { value: "auto-within-limits", label: "Automatico entro limiti" },
];

const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "Instagram",
  x: "X",
  pinterest: "Pinterest",
};

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

export default function SettingsSurface() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/settings`)
      .then((res) => {
        if (!res.ok) throw new Error(`Caricamento impostazioni fallito (${res.status})`);
        return res.json();
      })
      .then((data: TenantSettings) => {
        setSettings(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Errore inatteso"))
      .finally(() => setLoading(false));
  }, []);

  function update(patch: Partial<TenantSettings>) {
    setSettings((cur) => (cur ? { ...cur, ...patch } : cur));
    setSaved(false);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`Salvataggio fallito (${res.status})`);
      const updated = (await res.json()) as TenantSettings;
      setSettings(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore inatteso");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="surface-settings">
      <PageHeader
        testId="settings-header"
        title="Settings"
        subtitle="Brand voice, autonomia per specialista (stub) e canali — configurazione del tuo tenant."
      />

      {loading && <p>Caricamento…</p>}

      {error && (
        <p data-testid="settings-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {!loading && settings && (
        <div style={{ display: "grid", gap: space.lg, maxWidth: 640 }}>
          {/* Brand voice — the AI pipeline's voice, per tenant. */}
          <Card testId="settings-voice">
            <h2 style={{ fontSize: font.size.lg, margin: 0, color: color.text }}>Brand voice</h2>
            <p style={{ margin: `${space.xs} 0 0`, color: color.textMuted, fontSize: font.size.sm }}>
              La voce con cui l'AI propone i contenuti. L'AI propone, l'umano conferma.
            </p>
            <label style={labelStyle}>
              Tono
              <input
                data-testid="settings-voice-tone"
                value={settings.brandVoice.tone}
                onChange={(e) =>
                  update({ brandVoice: { ...settings.brandVoice, tone: e.target.value } })
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Pubblico
              <input
                data-testid="settings-voice-audience"
                value={settings.brandVoice.audience}
                onChange={(e) =>
                  update({ brandVoice: { ...settings.brandVoice, audience: e.target.value } })
                }
                style={inputStyle}
              />
            </label>
          </Card>

          {/* Per-specialist autonomy — STUB: persistence only, no engine yet. */}
          <Card testId="settings-autonomy">
            <h2 style={{ fontSize: font.size.lg, margin: 0, color: color.text }}>
              Autonomia per specialista
            </h2>
            <p
              data-testid="settings-autonomy-note"
              style={{ margin: `${space.xs} 0 0`, color: color.review, fontSize: font.size.sm }}
            >
              Solo informativo: per ora viene salvata la scelta. L'esecuzione automatica
              arriverà in una build successiva — il default è <strong>manuale</strong>.
            </p>
            {SPECIALISTS.map((s) => (
              <label key={s.key} style={labelStyle}>
                {s.label}
                <select
                  data-testid={`settings-autonomy-${s.key}`}
                  value={settings.specialistAutonomy[s.key]}
                  onChange={(e) =>
                    update({
                      specialistAutonomy: {
                        ...settings.specialistAutonomy,
                        [s.key]: e.target.value as AutonomyLevel,
                      },
                    })
                  }
                  style={inputStyle}
                >
                  {AUTONOMY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </Card>

          {/* Channels — intent only; real OAuth onboarding is DEBT-008. */}
          <Card testId="settings-channels">
            <h2 style={{ fontSize: font.size.lg, margin: 0, color: color.text }}>Canali</h2>
            <p style={{ margin: `${space.xs} 0 0`, color: color.textMuted, fontSize: font.size.sm }}>
              Quali canali di distribuzione usare. La connessione reale (OAuth) arriverà più avanti.
            </p>
            <div style={{ display: "grid", gap: space.sm, marginTop: space.md }}>
              {settings.channels.map((c, i) => (
                <label
                  key={c.channel}
                  data-testid={`settings-channel-${c.channel}`}
                  style={{ display: "flex", alignItems: "center", gap: space.sm, color: color.text }}
                >
                  <input
                    type="checkbox"
                    data-testid={`settings-channel-${c.channel}-toggle`}
                    checked={c.enabled}
                    onChange={(e) =>
                      update({
                        channels: settings.channels.map((ch, j) =>
                          j === i ? { ...ch, enabled: e.target.checked } : ch,
                        ),
                      })
                    }
                  />
                  {CHANNEL_LABEL[c.channel]}
                </label>
              ))}
            </div>
          </Card>

          <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
            <button
              data-testid="settings-save"
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
              <span
                data-testid="settings-save-status"
                style={{ color: color.approved, fontSize: font.size.sm }}
              >
                Salvato
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
