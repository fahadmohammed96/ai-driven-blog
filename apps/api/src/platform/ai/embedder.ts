export interface Embedder {
  embed(text: string): Promise<number[]>;
}

export const EMBED_DIM = 256;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic local embedder (feature hashing over tokens), L2-normalized.
 * Good enough to exercise the RAG path without an external embedding API;
 * swap for a semantic model (e.g. Voyage) later.
 */
export class HashingEmbedder implements Embedder {
  constructor(private readonly dim: number = EMBED_DIM) {}

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) {
      const idx = fnv1a(tok) % this.dim;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

/** Dot product; equals cosine similarity for L2-normalized vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
