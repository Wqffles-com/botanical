-- GitHub integration. A listener's `events` lists the `<X-GitHub-Event>.<action>` ids that start a
-- turn (empty for generic webhooks). A delivery GitHub sent for another event is kept as
-- `ignored`. The Coder and Orchestrator builtin roles gain the new `git` and `github`
-- capabilities, matching BUILTIN_ROLES in packages/agent-runtime/src/permissions.ts.

ALTER TABLE "listeners" ADD COLUMN IF NOT EXISTS "events" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "listener_deliveries" DROP CONSTRAINT IF EXISTS "listener_deliveries_status_check";--> statement-breakpoint
ALTER TABLE "listener_deliveries" ADD CONSTRAINT "listener_deliveries_status_check" CHECK ("status" in ('accepted', 'rejected', 'ignored', 'succeeded', 'failed'));--> statement-breakpoint
UPDATE "roles"
SET "permissions" = jsonb_set(
	"permissions",
	'{capabilities}',
	("permissions"->'capabilities') || '["git"]'::jsonb
)
WHERE "name" IN ('Coder', 'Orchestrator')
	AND "builtin" = true
	AND NOT ("permissions"->'capabilities' ? 'git');--> statement-breakpoint
UPDATE "roles"
SET "permissions" = jsonb_set(
	"permissions",
	'{capabilities}',
	("permissions"->'capabilities') || '["github"]'::jsonb
)
WHERE "name" IN ('Coder', 'Orchestrator')
	AND "builtin" = true
	AND NOT ("permissions"->'capabilities' ? 'github');
--> statement-breakpoint
UPDATE "roles"
SET "description" = 'Implements changes. Can read and write files, run shell and code, use git and GitHub, use the web and memory, and message agents. Cannot create agents.'
WHERE "name" = 'Coder'
	AND "builtin" = true
	AND "description" = 'Implements changes. Can read and write files, run shell and code, use the web and memory, and message agents. Cannot create agents.';
