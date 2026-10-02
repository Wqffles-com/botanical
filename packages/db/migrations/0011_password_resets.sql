-- Admin-generated, single-use password reset links. Only the SHA-256 of the link token is stored.

CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_not_blank" CHECK (char_length("token_hash") > 0),
	CONSTRAINT "password_resets_expiry_after_create" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_hash_uidx" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_id_idx" ON "password_resets" USING btree ("user_id");
