CREATE TYPE "public"."centre_source" AS ENUM('ssi');--> statement-breakpoint
CREATE TABLE "dive_centre" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dive_centre_name_ck" CHECK ("dive_centre"."name" ~ '\S' and length("dive_centre"."name") <= 200)
);
--> statement-breakpoint
CREATE TABLE "dive_centre_external_id" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"centre_id" uuid NOT NULL,
	"source" "centre_source" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dive_centre_site" (
	"centre_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_centre_site_centre_id_site_id_pk" PRIMARY KEY("centre_id","site_id")
);
--> statement-breakpoint
ALTER TABLE "dive_centre" ADD CONSTRAINT "dive_centre_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_centre_external_id" ADD CONSTRAINT "dive_centre_external_id_centre_id_dive_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."dive_centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_centre_site" ADD CONSTRAINT "dive_centre_site_centre_id_dive_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."dive_centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_centre_site" ADD CONSTRAINT "dive_centre_site_site_id_dive_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."dive_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_centre_external_id_source_uq" ON "dive_centre_external_id" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_centre_external_id_centre_source_uq" ON "dive_centre_external_id" USING btree ("centre_id","source");--> statement-breakpoint
CREATE INDEX "dive_centre_site_site_idx" ON "dive_centre_site" USING btree ("site_id");