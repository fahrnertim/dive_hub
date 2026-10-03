CREATE TYPE "public"."water_type" AS ENUM('fresh', 'salt', 'brackish', 'en13319', 'custom');--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "water_temperature_c" real;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "water_type" "water_type";--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "overrides" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;