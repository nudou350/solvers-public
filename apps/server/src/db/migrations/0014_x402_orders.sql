CREATE TABLE "x402_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"price" bigint NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"payer" text,
	"pay_signature" text,
	"mint_signature" text,
	"mint_wire" text,
	"mint_last_valid_height" bigint,
	"asset" text,
	"refund_signature" text,
	"refund_wire" text,
	"refund_last_valid_height" bigint,
	"error" text,
	"client_ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "x402_orders_status_idx" ON "x402_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "x402_orders_payer_idx" ON "x402_orders" USING btree ("payer");--> statement-breakpoint
CREATE INDEX "x402_orders_ip_idx" ON "x402_orders" USING btree ("client_ip","status");--> statement-breakpoint
CREATE UNIQUE INDEX "x402_orders_pay_signature_idx" ON "x402_orders" USING btree ("pay_signature") WHERE "x402_orders"."pay_signature" is not null;