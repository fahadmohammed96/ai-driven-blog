"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  StateBadge,
  EmptyState,
  type PublicationStatus,
} from "../../../src/ui/components";
import { color, font, radius, space } from "../../../src/ui/tokens";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Channels we project to from the Hub. Pinterest needs an image (it would have
// to enforce the requirement), so it lands in a later slice.
const CHANNELS = ["instagram", "x"] as const;

interface ArticleRow {
  id: string;
  type: string;
  status: string;
  title: string;
}

interface ChannelPost {
  id: string;
  channel: string;
  status: string;
}

/**
 * "Social / Post" surface (slice A3): the Hub's distribution control. List
 * articles, project one onto per-channel posts (deterministic repurpose), then
 * apply the human gate — approve each post before it can go out. Reuses the
 * Fase-2 social endpoints (POST :id/repurpose, :id/posts/:postId/approve).
 */
export default function SocialSurface() {
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [posts, setPosts] = useState<Record<string, ChannelPost[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/articles?type=article`);
      if (!res.ok) throw new Error("load failed");
      setArticles((await res.json()).items as ArticleRow[]);
    } catch {
      setError("Caricamento contenuti fallito");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Idempotent: show posts already derived from this article; only repurpose
  // (which inserts) when there are none, so re-clicking never duplicates.
  const generate = useCallback(async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const existing = await fetch(`${API}/articles/${id}/posts`);
      const existingPosts = existing.ok ? ((await existing.json()).posts as ChannelPost[]) : [];
      if (existingPosts.length > 0) {
        setPosts((cur) => ({ ...cur, [id]: existingPosts }));
        return;
      }
      const res = await fetch(`${API}/articles/${id}/repurpose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: CHANNELS }),
      });
      if (!res.ok) throw new Error("repurpose failed");
      const newPosts = (await res.json()).posts as ChannelPost[];
      setPosts((cur) => ({ ...cur, [id]: newPosts }));
    } catch {
      setError("Generazione post fallita");
    } finally {
      setBusy(null);
    }
  }, []);

  const approve = useCallback(async (articleId: string, postId: string) => {
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`${API}/articles/${articleId}/posts/${postId}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("approve failed");
      const updated = (await res.json()).post as ChannelPost;
      setPosts((cur) => ({
        ...cur,
        [articleId]: (cur[articleId] ?? []).map((p) =>
          p.id === updated.id ? { ...p, status: updated.status } : p,
        ),
      }));
    } catch {
      setError("Approvazione fallita");
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div data-testid="surface-social">
      <PageHeader
        testId="social-header"
        title="Social / Post"
        subtitle="Trasforma un articolo in post per canale: l'AI li adatta, tu li approvi prima che escano."
      />

      {error && (
        <p data-testid="social-error" style={{ color: color.danger }}>
          {error}
        </p>
      )}

      {loaded && articles.length === 0 && !error && (
        <EmptyState testId="social-empty" icon="📣" title="Nessun articolo da distribuire">
          Crea un articolo dalla superficie Crea, poi torna qui per generare i post.
        </EmptyState>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.md }}>
        {articles.map((a) => {
          const ps = posts[a.id] ?? [];
          return (
            <li key={a.id} data-testid="social-item" data-article-id={a.id}>
              <Card style={{ display: "grid", gap: space.sm }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: space.md,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: space.md, minWidth: 0 }}>
                    <StateBadge status={a.status as PublicationStatus} />
                    <span
                      style={{
                        fontWeight: 600,
                        color: color.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.title}
                    </span>
                  </span>
                  <button
                    data-testid="social-generate"
                    onClick={() => generate(a.id)}
                    disabled={busy === a.id}
                    style={primaryBtn(busy === a.id)}
                  >
                    {busy === a.id ? "Genero…" : "Genera post"}
                  </button>
                </div>

                {ps.length > 0 && (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space.xs }}>
                    {ps.map((p) => (
                      <li
                        key={p.id}
                        data-testid="social-post"
                        data-channel={p.channel}
                        data-status={p.status}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: space.md,
                          borderTop: `1px solid ${color.border}`,
                          paddingTop: space.xs,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            color: color.text,
                            textTransform: "capitalize",
                            minWidth: 90,
                          }}
                        >
                          {p.channel}
                        </span>
                        <span
                          data-testid="social-post-status"
                          style={{ color: color.textMuted, fontSize: font.size.sm }}
                        >
                          {p.status}
                        </span>
                        {p.status === "approved" ? (
                          <span
                            style={{
                              marginLeft: "auto",
                              color: color.approved,
                              fontSize: font.size.sm,
                              fontWeight: 600,
                            }}
                          >
                            Approvato ✓
                          </span>
                        ) : (
                          <button
                            data-testid="social-approve"
                            onClick={() => approve(a.id, p.id)}
                            disabled={busy === p.id}
                            style={{ ...primaryBtn(busy === p.id), marginLeft: "auto" }}
                          >
                            Approva
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function primaryBtn(disabled: boolean) {
  return {
    fontSize: font.size.sm,
    fontWeight: 600,
    padding: `${space.xs} ${space.md}`,
    borderRadius: radius.sm,
    border: "none",
    background: disabled ? color.border : color.accent,
    color: "#fff",
    cursor: disabled ? "default" : ("pointer" as const),
  };
}
