-- SQL-managed security objects. Keep in migrations: drizzle schema generation
-- does not model grants, role switching, or the shared-template trigger.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'content_pilot_tenant') THEN
    CREATE ROLE content_pilot_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'content_pilot_tenant' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'content_pilot_tenant must be a restricted NOLOGIN role';
  END IF;
  EXECUTE format('GRANT content_pilot_tenant TO %I', current_user);
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO content_pilot_tenant;
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['sites','credentials','content_templates','content_jobs',
    'briefs','autopilot_configs','discovered_topics','runs','run_items','llm_calls',
    'post_source_state','source_cache','subscriptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON %I TO content_pilot_tenant
      USING (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid)', tbl);
    EXECUTE format('GRANT SELECT ON %I TO content_pilot_tenant', tbl);
  END LOOP;
END $$;
--> statement-breakpoint
-- Only web-owned resources are writable. Billing, usage and logs stay read-only.
GRANT INSERT, UPDATE, DELETE ON sites, credentials, content_templates, content_jobs,
  briefs, autopilot_configs, discovered_topics, runs TO content_pilot_tenant;
--> statement-breakpoint
CREATE POLICY builtin_read ON content_templates FOR SELECT TO content_pilot_tenant
  USING (workspace_id IS NULL AND is_builtin = true);
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_workspace ON workspaces FOR SELECT TO content_pilot_tenant
  USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
GRANT SELECT (id, name, status, billing_bypass, created_at, updated_at) ON workspaces TO content_pilot_tenant;
--> statement-breakpoint
ALTER TABLE run_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_run_logs ON run_logs FOR SELECT TO content_pilot_tenant
  USING (EXISTS (SELECT 1 FROM runs WHERE runs.id = run_logs.run_id));
GRANT SELECT ON run_logs TO content_pilot_tenant;
--> statement-breakpoint
-- Composite foreign keys reject cross-tenant links even for workers/admin SQL.
-- Existing single-column FKs keep their cascade/set-null behavior.
DO $$ DECLARE tbl text; link text[]; BEGIN
  FOREACH tbl IN ARRAY ARRAY['credentials','sites','content_jobs','briefs','autopilot_configs','runs','run_items'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (workspace_id, id)', tbl, tbl || '_tenant_id_uq');
  END LOOP;
  FOREACH link SLICE 1 IN ARRAY ARRAY[
    ['sites','credential_id','credentials'],
    ['content_jobs','site_id','sites'], ['briefs','site_id','sites'], ['autopilot_configs','site_id','sites'],
    ['runs','job_id','content_jobs'], ['runs','brief_id','briefs'], ['runs','autopilot_config_id','autopilot_configs'],
    ['run_items','run_id','runs'], ['llm_calls','run_id','runs'], ['llm_calls','run_item_id','run_items'],
    ['discovered_topics','autopilot_config_id','autopilot_configs'], ['discovered_topics','run_id','runs'],
    ['discovered_topics','brief_id','briefs'], ['post_source_state','job_id','content_jobs']
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (workspace_id, %I) REFERENCES %I(workspace_id, id)',
      link[1], link[1] || '_' || link[2] || '_tenant_fk', link[2], link[3]);
  END LOOP;
END $$;
--> statement-breakpoint
-- Tenant ownership is immutable, including promotion of private templates to global.
CREATE FUNCTION public.prevent_tenant_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Workspace ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['users','sites','credentials','content_templates','content_jobs',
    'briefs','autopilot_configs','discovered_topics','runs','run_items','llm_calls',
    'post_source_state','source_cache','subscriptions'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_tenant BEFORE UPDATE OF workspace_id ON %I
      FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_move()', tbl);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.check_tenant_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.content_templates t WHERE t.id = NEW.template_id
    AND (t.workspace_id = NEW.workspace_id OR (t.workspace_id IS NULL AND t.is_builtin))) THEN
    RAISE EXCEPTION 'Template unavailable in this workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE tbl text; invalid boolean; BEGIN
  FOREACH tbl IN ARRAY ARRAY['content_jobs','briefs','autopilot_configs'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I x JOIN content_templates t ON t.id=x.template_id
      WHERE NOT (t.workspace_id IS NOT DISTINCT FROM x.workspace_id OR (t.workspace_id IS NULL AND t.is_builtin)))', tbl) INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'Existing cross-tenant template link in %; repair before migration', tbl; END IF;
    EXECUTE format('CREATE TRIGGER tenant_template BEFORE INSERT OR UPDATE OF template_id, workspace_id ON %I
      FOR EACH ROW EXECUTE FUNCTION public.check_tenant_template()', tbl);
  END LOOP;
END $$;

--> statement-breakpoint
CREATE TABLE rate_limits (
  key_hash text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);
