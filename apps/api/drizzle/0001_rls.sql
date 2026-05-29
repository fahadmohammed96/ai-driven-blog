-- Tenant isolation via Row-Level Security (ADR-0002).
-- The current tenant is carried in the GUC `app.current_tenant` (set per transaction).
-- FORCE RLS so even the table owner is subject to the policy.
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items FORCE ROW LEVEL SECURITY;

-- NULLIF(..., '') so both an unset GUC (NULL) and a reverted-to-empty GUC ('')
-- deny by default instead of raising on an invalid uuid cast.
CREATE POLICY tenant_isolation ON content_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
