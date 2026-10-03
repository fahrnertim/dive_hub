CREATE TABLE "dive_site" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"country" text,
	"water_body" text,
	"description" text,
	"created_by" uuid,
	"merged_into" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dive_site_position_ck" CHECK (("dive_site"."latitude" is null) = ("dive_site"."longitude" is null) and "dive_site"."latitude" between -90 and 90 and "dive_site"."longitude" between -180 and 180)
);
--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "entry_latitude" double precision;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "entry_longitude" double precision;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "exit_latitude" double precision;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "exit_longitude" double precision;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "positions_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dive_site" ADD CONSTRAINT "dive_site_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_site" ADD CONSTRAINT "dive_site_merged_into_dive_site_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."dive_site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dive_site_position_idx" ON "dive_site" USING btree ("latitude","longitude");--> statement-breakpoint
ALTER TABLE "dive" ADD CONSTRAINT "dive_site_id_dive_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."dive_site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dive_site_idx" ON "dive" USING btree ("site_id");