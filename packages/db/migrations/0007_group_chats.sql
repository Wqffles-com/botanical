-- Group chats: other agents that answer in a chat beside its owner, and the author of each reply.
-- Existing chats have no members. Existing messages keep a null author (read as the chat's owner).

ALTER TABLE "chats" ADD COLUMN "member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_agent_id_idx" ON "messages" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "chats_member_ids_idx" ON "chats" USING gin ("member_ids");--> statement-breakpoint
COMMENT ON COLUMN "chats"."member_ids" IS 'Other agents in a group chat, in speaking order. Empty for a one-agent chat.';--> statement-breakpoint
COMMENT ON COLUMN "messages"."agent_id" IS 'Agent that wrote an assistant or tool row. Null on user rows and rows written before group chats.';
