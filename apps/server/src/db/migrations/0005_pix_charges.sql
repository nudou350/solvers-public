CREATE TABLE "pix_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"external_reference" text NOT NULL,
	"amount_brl" integer NOT NULL,
	"amount_usdc" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"qr_code" text,
	"qr_base64" text,
	"ticket_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"credit_signature" text,
	"purpose" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pix_charges_external_reference_unique" UNIQUE("external_reference")
);
--> statement-breakpoint
CREATE INDEX "pix_charges_wallet_idx" ON "pix_charges" USING btree ("wallet","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pix_charges_order_idx" ON "pix_charges" USING btree ("provider_order_id");