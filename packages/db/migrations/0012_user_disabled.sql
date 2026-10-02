-- Admin-disabled accounts cannot sign in. Null means the account is active.

ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;
