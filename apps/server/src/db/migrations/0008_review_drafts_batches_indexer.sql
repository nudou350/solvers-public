CREATE TABLE "review_drafts" (
	"agent_id" text NOT NULL,
	"author_wallet" text NOT NULL,
	"content_hash" text NOT NULL,
	"rating" smallint NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_drafts_agent_id_author_wallet_content_hash_pk" PRIMARY KEY("agent_id","author_wallet","content_hash")
);
--> statement-breakpoint
CREATE TABLE "usage_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"count" integer NOT NULL,
	"merkle_root" text NOT NULL,
	"signature" text NOT NULL,
	"wire" text NOT NULL,
	"last_valid_height" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_txs" ADD COLUMN "block_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chain_txs" ADD COLUMN "fee" bigint;--> statement-breakpoint
ALTER TABLE "chain_txs" ADD COLUMN "creator_amount" bigint;--> statement-breakpoint
ALTER TABLE "chain_txs" ADD COLUMN "creator_wallet" text;--> statement-breakpoint
ALTER TABLE "chain_txs" ADD COLUMN "fee_bps" integer;--> statement-breakpoint
ALTER TABLE "indexer_failures" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "indexer_failures" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "indexer_failures" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pix_charges" ADD COLUMN "credit_wire" text;--> statement-breakpoint
ALTER TABLE "pix_charges" ADD COLUMN "credit_last_valid_height" bigint;--> statement-breakpoint
CREATE INDEX "usage_batches_status_idx" ON "usage_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chain_txs_agent_idx" ON "chain_txs" USING btree ("agent_id");