-- One chat per agent. An agent's one-agent chat (no member_ids) is its chat; group chats
-- (member_ids not empty) stay as extra threads. Keep each agent's most recently active
-- one-agent chat and delete the others. Messages and usage events go with them (ON DELETE
-- CASCADE); routine runs, listener deliveries and notifications keep their row with a null
-- chat_id (ON DELETE SET NULL). A chat that append-only tool_audit rows pin cannot be deleted
-- and is kept.

WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "agent_id" ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
  ) AS "rank"
  FROM "chats"
  WHERE cardinality("member_ids") = 0
)
DELETE FROM "chats" AS c
USING ranked AS r
WHERE c."id" = r."id"
  AND r."rank" > 1
  AND NOT EXISTS (SELECT 1 FROM "tool_audit" AS t WHERE t."chat_id" = c."id")
  AND NOT EXISTS (
    SELECT 1 FROM "tool_audit" AS t JOIN "messages" AS m ON m."id" = t."message_id" WHERE m."chat_id" = c."id"
  );--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "chats" WHERE cardinality("member_ids") = 0 GROUP BY "agent_id" HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'chats_agent_direct_uidx skipped: tool_audit pins more than one chat for an agent';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "chats_agent_direct_uidx" ON "chats" USING btree ("agent_id")
      WHERE cardinality("member_ids") = 0;
  END IF;
END
$$;
