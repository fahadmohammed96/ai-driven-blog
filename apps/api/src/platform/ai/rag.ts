import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Store a content chunk with its embedding (tenant-scoped). */
export async function storeChunk(
  db: Db,
  tenantId: string,
  content: string,
  embedding: number[],
): Promise<void> {
  const vec = toVectorLiteral(embedding);
  await db.execute(
    sql`insert into content_embeddings (tenant_id, content, embedding) values (${tenantId}::uuid, ${content}, ${vec}::vector)`,
  );
}

/** Retrieve the k most similar chunks (cosine distance) for a tenant. */
export async function retrieveSimilar(
  db: Db,
  tenantId: string,
  queryEmbedding: number[],
  k: number,
): Promise<string[]> {
  const vec = toVectorLiteral(queryEmbedding);
  const res = (await db.execute(
    sql`select content from content_embeddings where tenant_id = ${tenantId}::uuid order by embedding <=> ${vec}::vector limit ${k}`,
  )) as unknown as { rows: Array<{ content: string }> };
  return res.rows.map((r) => r.content);
}
