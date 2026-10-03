CREATE TYPE "public"."candidate_resolution" AS ENUM('attached', 'new_dive', 'discarded');--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ADD COLUMN "resolution" "candidate_resolution";--> statement-breakpoint
CREATE INDEX "duplicate_candidate_recording_idx" ON "duplicate_candidate" USING btree ("recording_id");