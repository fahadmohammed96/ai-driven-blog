import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { contentEmbeddings } from "../db/schema";

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
  await db.insert(contentEmbeddings).values({ tenantId, content, embedding });
}

/** Retrieve the k most similar chunks (cosine distance) for a tenant. */
export async function retrieveSimilar(
  db: Db,
  tenantId: string,
  queryEmbedding: number[],
  k: number,
): Promise<string[]> {
  const vec = toVectorLiteral(queryEmbedding);
  const rows = await db
    .select({ content: contentEmbeddings.content })
    .from(contentEmbeddings)
    .where(eq(contentEmbeddings.tenantId, tenantId))
    .orderBy(sql`${contentEmbeddings.embedding} <=> ${vec}::vector`)
    .limit(k);
  return rows.map((r) => r.content);
}
