ALTER TABLE "milestones" ADD COLUMN "acceptance_path" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "acceptance_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "license_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "batch_id" text;