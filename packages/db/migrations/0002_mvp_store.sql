CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_not_blank" CHECK (char_length("sessions"."token_hash") > 0),
	CONSTRAINT "sessions_expiry_after_create" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "model_profiles" ADD COLUMN "public_id" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uidx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_user_public_id_uidx" ON "model_profiles" USING btree ("user_id","public_id");--> statement-breakpoint
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_public_id_shape" CHECK ("model_profiles"."public_id" ~ '^[A-Za-z0-9_-]{1,64}$');
