CREATE TABLE "model_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"context_length" integer,
	"max_output_tokens" integer,
	"input_price_per_mtok" numeric(12, 6),
	"output_price_per_mtok" numeric(12, 6),
	"price_source" text DEFAULT 'unknown' NOT NULL,
	"supports_vision" boolean DEFAULT false NOT NULL,
	"supports_structured_output" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"available" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_profile_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"max_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "model_profile_entries" ADD CONSTRAINT "model_profile_entries_profile_id_model_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."model_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_catalog_provider_model_idx" ON "model_catalog" USING btree ("provider","model_id");--> statement-breakpoint
CREATE INDEX "model_catalog_available_idx" ON "model_catalog" USING btree ("provider","available");--> statement-breakpoint
CREATE UNIQUE INDEX "model_profile_entries_profile_purpose_idx" ON "model_profile_entries" USING btree ("profile_id","purpose");