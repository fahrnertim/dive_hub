-- Participants on Dives and Divers seen by every User (ADR 0028); what a Push left out, and requirements replacing the site ID code (ADR 0029).
CREATE TYPE "public"."participant_role" AS ENUM('buddy', 'guide', 'instructor');--> statement-breakpoint
CREATE TABLE "participant" (
	"dive_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"role" "participant_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_dive_id_diver_id_pk" PRIMARY KEY("dive_id","diver_id")
);
--> statement-breakpoint
ALTER TABLE "diver" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "push" ADD COLUMN "left_out" jsonb;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participant_diver_idx" ON "participant" USING btree ("diver_id");--> statement-breakpoint
ALTER TABLE "diver" ADD CONSTRAINT "diver_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "push" SET "error_code" = 'provider_requirements_unmet' WHERE "error_code" = 'provider_site_id_missing';