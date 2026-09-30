CREATE TABLE "agent_search_vectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_search_vectors_agent_idx" ON "agent_search_vectors" USING btree ("agent_id");