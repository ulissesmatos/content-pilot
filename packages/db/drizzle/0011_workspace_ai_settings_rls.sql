-- workspace_ai_settings is a web-owned resource (like credentials/sites): the
-- client reads and writes its own row directly through the tenant role.
ALTER TABLE workspace_ai_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON workspace_ai_settings TO content_pilot_tenant
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_ai_settings TO content_pilot_tenant;
