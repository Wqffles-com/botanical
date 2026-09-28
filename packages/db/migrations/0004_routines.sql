CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"profile_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routines_name_not_blank" CHECK (char_length(btrim("name")) between 1 and 120),
	CONSTRAINT "routines_prompt_not_blank" CHECK (char_length(btrim("prompt")) > 0),
	CONSTRAINT "routines_cron_not_blank" CHECK (char_length(btrim("cron")) between 1 and 80),
	CONSTRAINT "routines_timezone_not_blank" CHECK (char_length(btrim("timezone")) between 1 and 120),
	CONSTRAINT "routines_profile_id_shape" CHECK ("profile_id" ~ '^[A-Za-z0-9_-]{1,64}$')
);--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routines_user_created_idx" ON "routines" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "routines_agent_id_idx" ON "routines" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "routines_due_idx" ON "routines" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE TABLE "routine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"error" text,
	"chat_id" uuid,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routine_runs_trigger_check" CHECK ("trigger" in ('schedule', 'manual')),
	CONSTRAINT "routine_runs_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'failed', 'skipped'))
);--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routine_runs_routine_created_idx" ON "routine_runs" USING btree ("routine_id","created_at");--> statement-breakpoint
CREATE INDEX "routine_runs_open_lease_idx" ON "routine_runs" USING btree ("lease_expires_at") WHERE "status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "routine_runs_schedule_slot_uidx" ON "routine_runs" USING btree ("routine_id","scheduled_for") WHERE "trigger" = 'schedule';--> statement-breakpoint
CREATE TABLE "listeners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"profile_id" text NOT NULL,
	"prompt_template" text DEFAULT '' NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listeners_name_not_blank" CHECK (char_length(btrim("name")) between 1 and 120),
	CONSTRAINT "listeners_kind_not_blank" CHECK (char_length(btrim("kind")) between 1 and 40),
	CONSTRAINT "listeners_profile_id_shape" CHECK ("profile_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "listeners_secret_not_blank" CHECK (char_length("secret") >= 32)
);--> statement-breakpoint
ALTER TABLE "listeners" ADD CONSTRAINT "listeners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listeners" ADD CONSTRAINT "listeners_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listeners_user_created_idx" ON "listeners" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "listeners_agent_id_idx" ON "listeners" USING btree ("agent_id");--> statement-breakpoint
CREATE TABLE "listener_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listener_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"http_status" integer NOT NULL,
	"error" text,
	"payload_bytes" integer NOT NULL,
	"payload_preview" text DEFAULT '' NOT NULL,
	"chat_id" uuid,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	CONSTRAINT "listener_deliveries_status_check" CHECK ("status" in ('accepted', 'rejected', 'succeeded', 'failed')),
	CONSTRAINT "listener_deliveries_payload_bytes_nonneg" CHECK ("payload_bytes" >= 0)
);--> statement-breakpoint
ALTER TABLE "listener_deliveries" ADD CONSTRAINT "listener_deliveries_listener_id_listeners_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."listeners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listener_deliveries" ADD CONSTRAINT "listener_deliveries_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listener_deliveries_listener_received_idx" ON "listener_deliveries" USING btree ("listener_id","received_at");--> statement-breakpoint
CREATE INDEX "listener_deliveries_open_lease_idx" ON "listener_deliveries" USING btree ("lease_expires_at") WHERE "status" = 'accepted';--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"agent_id" uuid,
	"chat_id" uuid,
	"routine_run_id" uuid,
	"listener_delivery_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('run_succeeded', 'run_failed', 'attention')),
	CONSTRAINT "notifications_title_not_blank" CHECK (char_length(btrim("title")) between 1 and 200)
);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_routine_run_id_routine_runs_id_fk" FOREIGN KEY ("routine_run_id") REFERENCES "public"."routine_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_listener_delivery_id_listener_deliveries_id_fk" FOREIGN KEY ("listener_delivery_id") REFERENCES "public"."listener_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "read_at" is null;--> statement-breakpoint
UPDATE "roles"
SET "permissions" = jsonb_set(
	"permissions",
	'{capabilities}',
	("permissions"->'capabilities') || '["notify"]'::jsonb
)
WHERE "name" = 'Orchestrator'
	AND "builtin" = true
	AND NOT ("permissions"->'capabilities' ? 'notify');
