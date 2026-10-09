ALTER TYPE "public"."push_action" ADD VALUE 'number';--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "follow_numbers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "diver" ADD COLUMN "dives_before" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "diver" ADD COLUMN "apnea_counts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "diver" ADD CONSTRAINT "diver_dives_before_ck" CHECK ("diver"."dives_before" between 0 and 100000);