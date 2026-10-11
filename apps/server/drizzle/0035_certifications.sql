CREATE TYPE "public"."certification_image_state" AS ENUM('none', 'pending', 'stored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."certification_verification" AS ENUM('self_declared', 'card_seen', 'verified_with_agency');--> statement-breakpoint
CREATE TABLE "certification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"diver_id" uuid NOT NULL,
	"agency" text NOT NULL,
	"level" text NOT NULL,
	"number" text,
	"issued_on" date,
	"expires_on" date,
	"dives_at_issue" integer,
	"instructor_name" text,
	"instructor_number" text,
	"centre_name" text,
	"centre_number" text,
	"centre_city" text,
	"centre_country" text,
	"verification" "certification_verification" DEFAULT 'self_declared' NOT NULL,
	"notes" text,
	"source" text,
	"external_id" text,
	"remote_course_id" text,
	"category" text,
	"image_url" text,
	"image_key" text,
	"image_sha256" text,
	"image_bytes" integer,
	"image_state" "certification_image_state" DEFAULT 'none' NOT NULL,
	"imported_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "certification_source_ck" CHECK (("certification"."source" is null) = ("certification"."external_id" is null)),
	CONSTRAINT "certification_dives_ck" CHECK ("certification"."dives_at_issue" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "certification" ADD CONSTRAINT "certification_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certification_diver_idx" ON "certification" USING btree ("diver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certification_card_uq" ON "certification" USING btree ("diver_id","source","external_id") WHERE "certification"."external_id" is not null;