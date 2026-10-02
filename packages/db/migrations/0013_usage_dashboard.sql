-- Usage dashboard. Each model call now records the agent that made it, the profile it ran on
-- (as the public id, so a deleted profile still groups), and the source of the turn.

ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "profile_ref" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "usage_events_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "usage_events_source_check";--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_source_check" CHECK ("source" in ('chat', 'routine', 'listener', 'agent_mail'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_created_idx" ON "usage_events" USING btree ("created_at");
