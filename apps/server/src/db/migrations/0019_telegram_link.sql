ALTER TABLE "creators" ADD COLUMN "telegram_link_hash" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "telegram_link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "telegram_link_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "telegram_link_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_telegram_link_hash_idx" ON "creators" USING btree ("telegram_link_hash") WHERE "creators"."telegram_link_hash" is not null;