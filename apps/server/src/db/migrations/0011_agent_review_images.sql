CREATE TABLE "agent_images" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"position" smallint NOT NULL,
	"key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_images_pos_chk" CHECK ("agent_images"."position" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "review_images" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"position" smallint NOT NULL,
	"key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_images_pos_chk" CHECK ("review_images"."position" between 0 and 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_images_pos_idx" ON "agent_images" USING btree ("agent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "review_images_pos_idx" ON "review_images" USING btree ("review_id","position");