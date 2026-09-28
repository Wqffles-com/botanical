-- Per-bot title, avatar shape, and optional picture.
-- Existing rows keep a squircle mark and no picture.

ALTER TABLE "agents" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "shape" text DEFAULT 'squircle' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "picture" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_title_length" CHECK (char_length("title") <= 60);--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_shape_known" CHECK ("shape" in ('circle', 'squircle', 'square', 'hexagon', 'diamond', 'shield'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_picture_data_url" CHECK ("picture" is null or (
  char_length("picture") between 1 and 200000
  and "picture" ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
));--> statement-breakpoint
COMMENT ON COLUMN "agents"."title" IS 'Short role label, up to 60 characters.';--> statement-breakpoint
COMMENT ON COLUMN "agents"."shape" IS 'Avatar silhouette: circle, squircle, square, hexagon, diamond, or shield.';--> statement-breakpoint
COMMENT ON COLUMN "agents"."picture" IS 'Optional PNG, JPEG, or WebP data URL. Null shows the shape and icon.';
