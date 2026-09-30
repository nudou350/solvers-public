ALTER TABLE "trials" ADD COLUMN "searches_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "tool_runs" jsonb DEFAULT '{}'::jsonb NOT NULL;