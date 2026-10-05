CREATE TYPE "public"."dive_import_mode" AS ENUM('off', 'add', 'create');--> statement-breakpoint
CREATE TYPE "public"."utc_offset_source" AS ENUM('device', 'position', 'nearby', 'unknown');--> statement-breakpoint
ALTER TABLE "import" ALTER COLUMN "upload_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "import_mode" "dive_import_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "import_window_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "import_computers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "utc_offset_source" "utc_offset_source" DEFAULT 'device' NOT NULL;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "from_provider" text;--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "utc_offset_source" "utc_offset_source" DEFAULT 'device' NOT NULL;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_import_window_ck" CHECK ("connection"."import_window_minutes" in (5, 15, 30, 60));