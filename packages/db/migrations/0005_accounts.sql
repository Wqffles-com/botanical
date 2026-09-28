-- Accounts replace the single passcode.
-- Sessions belong to a user. Existing passcode sessions are dropped.
-- Global model profiles and encrypted keys use a null user_id.

ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" in ('admin', 'member'));--> statement-breakpoint
UPDATE "users" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at", "id" LIMIT 1);--> statement-breakpoint
DELETE FROM "sessions";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_not_blank" CHECK (char_length("token_hash") > 0),
	CONSTRAINT "invites_expiry_after_create" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_uidx" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invites_created_by_idx" ON "invites" USING btree ("created_by");--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"last4" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_name_format" CHECK ("name" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "secrets_last4_len" CHECK (char_length("last4") <= 4),
	CONSTRAINT "secrets_ciphertext_not_blank" CHECK (char_length("ciphertext") > 0)
);--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_global_name_uidx" ON "secrets" USING btree ("name") WHERE "user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_user_name_uidx" ON "secrets" USING btree ("user_id","name") WHERE "user_id" is not null;--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "user_settings_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_.]*$')
);--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "model_profiles_user_name_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "model_profiles_user_public_id_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_user_name_uidx" ON "model_profiles" USING btree ("user_id","name") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_user_public_id_uidx" ON "model_profiles" USING btree ("user_id","public_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_global_name_uidx" ON "model_profiles" USING btree ("name") WHERE "user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_global_public_id_uidx" ON "model_profiles" USING btree ("public_id") WHERE "user_id" is null;--> statement-breakpoint
CREATE INDEX "model_profiles_user_id_idx" ON "model_profiles" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "settings" ("key", "value")
VALUES
  ('auth.signup_mode', '"open"'::jsonb),
  ('providers.allow_global_keys', 'true'::jsonb)
ON CONFLICT ("key") DO NOTHING;
