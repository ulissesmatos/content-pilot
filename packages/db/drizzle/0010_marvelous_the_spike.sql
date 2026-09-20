CREATE TABLE "workspace_ai_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"provider" text,
	"model" text,
	"image_gen_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;