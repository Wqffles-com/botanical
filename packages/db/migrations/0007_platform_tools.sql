-- Example agents get Botanical's platform tools (memory, agent directory,
-- notify, agent messages), matching PLATFORM_TOOLS in packages/core/src/agents.ts.
-- Without them a coding CLI's `botanical` MCP server listed no memory tools (issue #92).
-- Only rows whose tools are still exactly the original seed are changed, so an
-- operator's edits stay as they are. A fresh database has no rows yet; the seed
-- in packages/db/sql/seed-agents.sql inserts the new lists.

UPDATE "agents" SET "tools" = '[{"name":"web_search","enabled":true},{"name":"web_fetch","enabled":true},{"name":"memory_write","enabled":true},{"name":"memory_search","enabled":true},{"name":"memory_list","enabled":true},{"name":"memory_delete","enabled":true},{"name":"agent_list","enabled":true},{"name":"agent_create","enabled":true},{"name":"notify_user","enabled":true},{"name":"send_agent_message","enabled":true}]'::jsonb
WHERE "id" IN ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333')
  AND "tools" = '[{"name":"web_search","enabled":true},{"name":"web_fetch","enabled":true}]'::jsonb;--> statement-breakpoint
UPDATE "agents" SET "tools" = '[{"name":"shell","enabled":true},{"name":"code_exec","enabled":true},{"name":"file_read","enabled":true},{"name":"file_write","enabled":true},{"name":"file_list","enabled":true},{"name":"memory_write","enabled":true},{"name":"memory_search","enabled":true},{"name":"memory_list","enabled":true},{"name":"memory_delete","enabled":true},{"name":"agent_list","enabled":true},{"name":"agent_create","enabled":true},{"name":"notify_user","enabled":true},{"name":"send_agent_message","enabled":true}]'::jsonb
WHERE "id" = '22222222-2222-4222-8222-222222222222'
  AND "tools" = '[{"name":"shell","enabled":true},{"name":"code_exec","enabled":true},{"name":"file_read","enabled":true},{"name":"file_write","enabled":true},{"name":"file_list","enabled":true}]'::jsonb;
