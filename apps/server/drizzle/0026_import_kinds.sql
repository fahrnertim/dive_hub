ALTER TYPE "public"."import_status" ADD VALUE 'awaiting_choice';--> statement-breakpoint
ALTER TYPE "public"."import_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "found" jsonb;--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "kinds" jsonb;