CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"listing_address" text NOT NULL,
	"seller_wallet" text NOT NULL,
	"price" bigint NOT NULL,
	"fee_bps" integer NOT NULL,
	"royalty_bps" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"buyer_wallet" text,
	"sold_price" bigint,
	"royalty" bigint,
	"fee" bigint,
	"seller_amount" bigint,
	"open_signature" text,
	"close_signature" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "listings_active_license_idx" ON "listings" USING btree ("license_id") WHERE "listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "listings_agent_status_idx" ON "listings" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "listings_seller_idx" ON "listings" USING btree ("seller_wallet");