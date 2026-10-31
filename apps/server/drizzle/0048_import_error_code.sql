CREATE TYPE "public"."import_error_code" AS ENUM('unsupported_file', 'processing_failed', 'choice_expired');--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "error_code" "import_error_code";--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "error_detail" text;