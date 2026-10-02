CREATE TABLE "agent_published_versions" (
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"version_hash" text NOT NULL,
	"price_usdc" bigint NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approve_tx" text,
	CONSTRAINT "agent_published_versions_agent_id_version_pk" PRIMARY KEY("agent_id","version")
);
--> statement-breakpoint
CREATE TABLE "creator_invites" (
	"code" text PRIMARY KEY NOT NULL,
	"email" text,
	"note" text,
	"wallet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"files_total" integer DEFAULT 0 NOT NULL,
	"files_done" integer DEFAULT 0 NOT NULL,
	"chunks_done" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "package_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"reviewer_wallet" text NOT NULL,
	"action" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version_hash" text,
	"diff_snapshot" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_wallet" text NOT NULL,
	"agent_id" text NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"zip_path" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"manifest" jsonb,
	"validation" jsonb,
	"scans" jsonb,
	"approved" jsonb,
	"reviewer_notes" text,
	"register_tx" text,
	"approve_tx" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sync_flag" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "invited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "valid_until" date;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_jobs_submission_idx" ON "ingest_jobs" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "package_reviews_submission_idx" ON "package_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "package_submissions_creator_idx" ON "package_submissions" USING btree ("creator_wallet","created_at");--> statement-breakpoint
CREATE INDEX "package_submissions_status_idx" ON "package_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "package_submissions_slug_idx" ON "package_submissions" USING btree ("slug");--> statement-breakpoint
-- Criadores que já publicaram pelo CLI continuam podendo operar; o convite vale só para quem chega agora.
UPDATE "creators" SET "invited" = true, "terms_accepted_at" = now();--> statement-breakpoint
-- Backfill: as versões hoje no catálogo são as aprovadas (sem isso o indexador marcaria todas como "não aprovadas").
INSERT INTO "agent_published_versions" ("agent_id", "version", "version_hash", "price_usdc")
SELECT "id", "version", "version_hash", "price" FROM "agents" ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Trilha de auditoria somente-inserção (PACKAGE_SPEC.md 17, item 8).
CREATE FUNCTION "package_reviews_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'package_reviews é somente-inserção';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "package_reviews_no_update_delete" BEFORE UPDATE OR DELETE ON "package_reviews"
FOR EACH ROW EXECUTE FUNCTION "package_reviews_append_only"();
