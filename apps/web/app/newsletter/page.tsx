"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [subTheme, setSubTheme] = useState("party");
  const [subscribed, setSubscribed] = useState(false);

  const [sendTheme, setSendTheme] = useState("party");
  const [subject, setSubject] = useState("Novità dal blog");
  const [html, setHtml] = useState("<h1>Ciao!</h1>");
  const [sent, setSent] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    setError(null);
    setSubscribed(false);
    const res = await fetch(`${API}/newsletter/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, themes: [subTheme] }),
    });
    if (!res.ok) return setError("Iscrizione fallita");
    setSubscribed(true);
  }

  async function send() {
    setError(null);
    setSent(null);
    const res = await fetch(`${API}/newsletter/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: sendTheme, subject, html }),
    });
    if (!res.ok) return setError("Invio fallito");
    setSent((await res.json()).sent);
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Newsletter</h1>
      {error && <p data-testid="nl-error" style={{ color: "crimson" }}>{error}</p>}

      <section>
        <h2>Iscrizione (double opt-in)</h2>
        <p>L&apos;iscritto riceve un&apos;email e conferma cliccando il link (GDPR).</p>
        <input
          data-testid="nl-email"
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
        <input
          data-testid="nl-theme"
          placeholder="tema (es. party)"
          value={subTheme}
          onChange={(e) => setSubTheme(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
        <button data-testid="nl-subscribe" onClick={subscribe}>Iscrivi</button>
        {subscribed && <p data-testid="nl-subscribed">Iscrizione richiesta — conferma via email ✓</p>}
      </section>

      <section>
        <h2>Invio segmentato</h2>
        <input
          data-testid="nl-send-theme"
          placeholder="tema destinatari"
          value={sendTheme}
          onChange={(e) => setSendTheme(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
        <input
          data-testid="nl-send-subject"
          placeholder="oggetto"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
        <textarea
          data-testid="nl-send-html"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
        <button data-testid="nl-send" onClick={send}>Invia al segmento</button>
        {sent !== null && <p data-testid="nl-sent">Inviata a {sent} destinatari</p>}
      </section>
    </main>
  );
}
