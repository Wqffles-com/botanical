CREATE TYPE "public"."a2a_status" AS ENUM('pending', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent" uuid NOT NULL,
	"to_agent" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "a2a_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_messages_distinct_ends" CHECK ("agent_messages"."from_agent" <> "agent_messages"."to_agent"),
	CONSTRAINT "agent_messages_body_not_blank" CHECK (char_length(btrim("agent_messages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_name_not_blank" CHECK (char_length(btrim("agents"."name")) > 0),
	CONSTRAINT "agents_tools_is_array" CHECK (jsonb_typeof("agents"."tools") = 'array')
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role" "message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"parts" jsonb,
	"tool_call_id" text,
	"tool_calls" jsonb,
	"name" text,
	"profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tool_role_has_call_id" CHECK ("messages"."role" <> 'tool' or ("messages"."tool_call_id" is not null and char_length("messages"."tool_call_id") > 0))
);
--> statement-breakpoint
CREATE TABLE "model_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_profiles_provider_model_not_blank" CHECK (char_length(btrim("model_profiles"."provider")) > 0 and char_length(btrim("model_profiles"."model")) > 0 and char_length(btrim("model_profiles"."name")) > 0),
	CONSTRAINT "model_profiles_config_is_object" CHECK (jsonb_typeof("model_profiles"."config") = 'object'),
	CONSTRAINT "model_profiles_config_has_no_raw_key" CHECK (not (
        jsonb_exists("model_profiles"."config", 'apiKey')
        or jsonb_exists("model_profiles"."config", 'api_key')
        or jsonb_exists("model_profiles"."config", 'secret')
        or jsonb_exists("model_profiles"."config", 'token')
        or jsonb_exists("model_profiles"."config", 'password')
      ))
);
--> statement-breakpoint
CREATE TABLE "secret_refs" (
	"logical_name" text PRIMARY KEY NOT NULL,
	"env_var" text NOT NULL,
	"provider" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_refs_logical_name_format" CHECK ("secret_refs"."logical_name" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "secret_refs_env_var_name" CHECK ("secret_refs"."env_var" ~ '^[A-Z][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_format" CHECK ("settings"."key" ~ '^[a-z][a-z0-9_.]*$')
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_name_not_blank" CHECK (char_length(btrim("tenants"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tool_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"chat_id" uuid,
	"message_id" uuid,
	"agent_id" uuid,
	"tool_name" text NOT NULL,
	"args_redacted" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_audit_tool_name_not_blank" CHECK (char_length(btrim("tool_audit"."tool_name")) > 0),
	CONSTRAINT "tool_audit_status_known" CHECK ("tool_audit"."status" in ('ok', 'error', 'denied', 'pending_approval'))
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid,
	"message_id" uuid,
	"profile_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(14, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_tokens_nonneg" CHECK ("usage_events"."input_tokens" >= 0 and "usage_events"."output_tokens" >= 0),
	CONSTRAINT "usage_events_provider_model_not_blank" CHECK (char_length(btrim("usage_events"."provider")) > 0 and char_length(btrim("usage_events"."model")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"display_name" text NOT NULL,
	"email" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_display_name_not_blank" CHECK (char_length(btrim("users"."display_name")) > 0),
	CONSTRAINT "users_email_shape" CHECK ("users"."email" is null or "users"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_from_agent_agents_id_fk" FOREIGN KEY ("from_agent") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_to_agent_agents_id_fk" FOREIGN KEY ("to_agent") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_profile_id_model_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_profile_id_model_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."model_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit" ADD CONSTRAINT "tool_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit" ADD CONSTRAINT "tool_audit_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit" ADD CONSTRAINT "tool_audit_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit" ADD CONSTRAINT "tool_audit_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_profile_id_model_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."model_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_inbox_idx" ON "agent_messages" USING btree ("to_agent","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_outbox_idx" ON "agent_messages" USING btree ("from_agent","created_at");--> statement-breakpoint
CREATE INDEX "agents_user_id_idx" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chats_user_created_idx" ON "chats" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chats_agent_id_idx" ON "chats" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "chats_profile_id_idx" ON "chats" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "messages_chat_seq_idx" ON "messages" USING btree ("chat_id","seq");--> statement-breakpoint
CREATE INDEX "messages_profile_id_idx" ON "messages" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_user_name_uidx" ON "model_profiles" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "tool_audit_chat_created_idx" ON "tool_audit" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_audit_agent_id_idx" ON "tool_audit" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "tool_audit_user_id_idx" ON "tool_audit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_events_user_created_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_profile_created_idx" ON "usage_events" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_chat_id_idx" ON "usage_events" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "users_tenant_id_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree (lower("email")) WHERE "users"."email" is not null;