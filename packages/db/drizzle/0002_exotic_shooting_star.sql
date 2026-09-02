CREATE TABLE "autopilot_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"seed_topics" text[] DEFAULT '{}' NOT NULL,
	"language" text DEFAULT 'pt-BR' NOT NULL,
	"schedule_cron" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"auto_queue" boolean DEFAULT false NOT NULL,
	"publish_mode" text DEFAULT 'draft' NOT NULL,
	"discovery" jsonb NOT NULL,
	"llm_config" jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovered_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"autopilot_config_id" uuid NOT NULL,
	"run_id" uuid,
	"topic" text NOT NULL,
	"content_type" text NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"angle" text,
	"suggested_title" text,
	"status" text NOT NULL,
	"discard_reason" text,
	"brief_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "autopilot_config_id" uuid;--> statement-breakpoint
ALTER TABLE "autopilot_configs" ADD CONSTRAINT "autopilot_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_configs" ADD CONSTRAINT "autopilot_configs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_configs" ADD CONSTRAINT "autopilot_configs_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_autopilot_config_id_autopilot_configs_id_fk" FOREIGN KEY ("autopilot_config_id") REFERENCES "public"."autopilot_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_configs_due_idx" ON "autopilot_configs" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "discovered_topics_config_created_idx" ON "discovered_topics" USING btree ("autopilot_config_id","created_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_autopilot_config_id_autopilot_configs_id_fk" FOREIGN KEY ("autopilot_config_id") REFERENCES "public"."autopilot_configs"("id") ON DELETE no action ON UPDATE no action;