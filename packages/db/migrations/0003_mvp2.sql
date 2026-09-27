ALTER TABLE "agents" ADD COLUMN "created_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" jsonb NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_not_blank" CHECK (char_length(btrim("name")) > 0),
	CONSTRAINT "roles_name_length" CHECK (char_length(btrim("name")) between 1 and 80),
	CONSTRAINT "roles_permissions_object" CHECK (jsonb_typeof("permissions") = 'object')
);--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_uidx" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE TABLE "agent_roles" (
	"agent_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_roles_agent_id_role_id_pk" PRIMARY KEY("agent_id","role_id")
);--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_roles_role_id_idx" ON "agent_roles" USING btree ("role_id");--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"agent_id" uuid,
	"content" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_scope_check" CHECK ("scope" in ('shared', 'agent')),
	CONSTRAINT "memories_agent_scope" CHECK (("scope" = 'shared') or ("scope" = 'agent' and "agent_id" is not null)),
	CONSTRAINT "memories_content_not_blank" CHECK (char_length(btrim("content")) > 0)
);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_user_scope_idx" ON "memories" USING btree ("user_id","scope","updated_at");--> statement-breakpoint
CREATE INDEX "memories_agent_id_idx" ON "memories" USING btree ("agent_id");--> statement-breakpoint
INSERT INTO "roles" ("id", "name", "description", "permissions", "builtin") VALUES
	(
		'00000000-0000-4000-8000-0000000000c1',
		'Coder',
		'Implements changes. Can read and write files, run shell and code, use the web and memory, and message agents. Cannot create agents.',
		'{"capabilities":["file.read","file.write","shell","code_exec","web","memory.read","memory.write","agent.message"],"mcp":[]}'::jsonb,
		true
	),
	(
		'00000000-0000-4000-8000-0000000000c2',
		'Reviewer',
		'Reads code, searches the web, and reads memory. Cannot write files, run commands, or create agents.',
		'{"capabilities":["file.read","web","memory.read"],"mcp":[]}'::jsonb,
		true
	),
	(
		'00000000-0000-4000-8000-0000000000c3',
		'Orchestrator',
		'Full access, including creating agents, messaging agents, and every MCP server.',
		'{"capabilities":["file.read","file.write","shell","code_exec","web","memory.read","memory.write","agent.create","agent.message"],"mcp":[{"server":"*"}]}'::jsonb,
		true
	)
ON CONFLICT ("name") DO NOTHING;