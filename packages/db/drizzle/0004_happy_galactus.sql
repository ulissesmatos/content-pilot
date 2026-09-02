CREATE TABLE "run_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"line" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovered_topics" DROP CONSTRAINT "discovered_topics_autopilot_config_id_autopilot_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "discovered_topics" DROP CONSTRAINT "discovered_topics_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "discovered_topics" DROP CONSTRAINT "discovered_topics_brief_id_briefs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_job_id_content_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_brief_id_briefs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_autopilot_config_id_autopilot_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_items" DROP CONSTRAINT "run_items_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_run_item_id_run_items_id_fk";
--> statement-breakpoint
ALTER TABLE "post_source_state" DROP CONSTRAINT "post_source_state_job_id_content_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "kind" text DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_logs" ADD CONSTRAINT "run_logs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_logs_run_ts_idx" ON "run_logs" USING btree ("run_id","ts");--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_autopilot_config_id_autopilot_configs_id_fk" FOREIGN KEY ("autopilot_config_id") REFERENCES "public"."autopilot_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_topics" ADD CONSTRAINT "discovered_topics_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_autopilot_config_id_autopilot_configs_id_fk" FOREIGN KEY ("autopilot_config_id") REFERENCES "public"."autopilot_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_item_id_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."run_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_source_state" ADD CONSTRAINT "post_source_state_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "runs" SET "kind" = CASE
  WHEN "brief_id" IS NOT NULL THEN 'create'
  WHEN "autopilot_config_id" IS NOT NULL THEN 'discover'
  ELSE 'update' END;