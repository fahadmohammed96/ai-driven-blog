-- AI/RAG: embeddings store (pgvector). Requires the pgvector image/extension.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS content_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  content text NOT NULL,
  embedding vector(256) NOT NULL
);

-- Same tenant-isolation pattern as content_items (ADR-0002).
ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON content_embeddings
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
