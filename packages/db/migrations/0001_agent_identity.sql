CREATE TYPE "public"."agent_color" AS ENUM('red', 'orange', 'amber', 'green', 'teal', 'cyan', 'blue', 'violet', 'pink', 'gray');--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "icon" text DEFAULT 'Bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "color" "agent_color" DEFAULT 'green' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "default_profile_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_name_length" CHECK (char_length(btrim("agents"."name")) between 1 and 40);--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_icon_lucide_name" CHECK ("agents"."icon" ~ '^[A-Z][A-Za-z0-9]{0,63}$');--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_default_profile_id_shape" CHECK ("agents"."default_profile_id" is null or (
        char_length("agents"."default_profile_id") between 1 and 200
        and "agents"."default_profile_id" = btrim("agents"."default_profile_id")
      ));