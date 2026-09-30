CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"creator_id" text NOT NULL,
	"version" text NOT NULL,
	"version_hash" text NOT NULL,
	"price" bigint NOT NULL,
	"price_per_use" bigint DEFAULT 0 NOT NULL,
	"royalty_bps" integer DEFAULT 0 NOT NULL,
	"eval_score_bps" integer DEFAULT 0 NOT NULL,
	"eval_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_sales" bigint DEFAULT 0 NOT NULL,
	"verified_uses" bigint DEFAULT 0 NOT NULL,
	"rating_sum" bigint DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"disputes_lost" integer DEFAULT 0 NOT NULL,
	"stake" bigint DEFAULT 0 NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"package_contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guarantee_available" boolean DEFAULT false NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onchain_address" text,
	"collection_address" text,
	"search_text" text DEFAULT '' NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_txs" (
	"signature" text PRIMARY KEY NOT NULL,
	"wallet" text,
	"kind" text NOT NULL,
	"agent_id" text,
	"amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"bio" text DEFAULT '' NOT NULL,
	"telegram_chat_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"agent_id" text NOT NULL,
	"owner_wallet" text NOT NULL,
	"remaining" integer DEFAULT 0 NOT NULL,
	"purchased" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_agent_id_owner_wallet_pk" PRIMARY KEY("agent_id","owner_wallet")
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text,
	"summary" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"buyer_wallet" text NOT NULL,
	"creator_wallet" text NOT NULL,
	"nonce" bigint NOT NULL,
	"total" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auto_release_at" timestamp with time zone,
	"review_window_secs" integer NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"source" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384)
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner_wallet" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text DEFAULT 'permanent' NOT NULL,
	"listed_for_resale" boolean DEFAULT false NOT NULL,
	"resale_price" bigint,
	"signature" text
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"agent_id" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_keys" (
	"token_id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"escrow_id" text NOT NULL,
	"idx" integer NOT NULL,
	"title" text NOT NULL,
	"criteria" text NOT NULL,
	"criteria_hash" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"passed_at" timestamp with time zone,
	"deliverable_path" text,
	"deliverable_hash" text,
	"preview_url" text,
	"verifier_report" jsonb,
	"dispute_reason" text,
	"dispute_criterion" text,
	CONSTRAINT "milestones_escrow_id_idx_pk" PRIMARY KEY("escrow_id","idx")
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"wallet" text NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text,
	"resource" text,
	"memory_key" "bytea",
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"wallet" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"signature" text NOT NULL,
	"idx" integer NOT NULL,
	"name" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_signature_idx_pk" PRIMARY KEY("signature","idx")
);
--> statement-breakpoint
CREATE TABLE "resale_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"price" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"author_wallet" text NOT NULL,
	"rating" smallint NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"onchain" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"access" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"agent_id" text NOT NULL,
	"wallet" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trials_agent_id_wallet_pk" PRIMARY KEY("agent_id","wallet")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"agent_id" text,
	"session_id" text,
	"tool" text NOT NULL,
	"response_hash" text,
	"batched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_reputation" (
	"wallet" text PRIMARY KEY NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"disputes_opened" integer DEFAULT 0 NOT NULL,
	"disputes_lost" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agents_onchain_idx" ON "agents" USING btree ("onchain_address");--> statement-breakpoint
CREATE INDEX "agents_fts_idx" ON "agents" USING gin (to_tsvector('portuguese', "search_text"));--> statement-breakpoint
CREATE INDEX "chain_txs_wallet_idx" ON "chain_txs" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "escrows_buyer_idx" ON "escrows" USING btree ("buyer_wallet");--> statement-breakpoint
CREATE INDEX "knowledge_agent_idx" ON "knowledge_chunks" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "knowledge_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_fts_idx" ON "knowledge_chunks" USING gin (to_tsvector('portuguese', "content"));--> statement-breakpoint
CREATE INDEX "licenses_owner_idx" ON "licenses" USING btree ("owner_wallet");--> statement-breakpoint
CREATE INDEX "licenses_agent_idx" ON "licenses" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_wallet_agent_idx" ON "memories" USING btree ("wallet","agent_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_wallet_idx" ON "oauth_tokens" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_agent_author_idx" ON "reviews" USING btree ("agent_id","author_wallet");--> statement-breakpoint
CREATE INDEX "usage_agent_created_idx" ON "usage_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_wallet_idx" ON "usage_events" USING btree ("wallet");