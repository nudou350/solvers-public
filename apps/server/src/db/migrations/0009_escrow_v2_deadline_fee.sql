ALTER TABLE "escrows" ADD COLUMN "delivery_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escrows" ADD COLUMN "fee_bps" integer;