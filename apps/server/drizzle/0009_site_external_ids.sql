CREATE TYPE "public"."site_import_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."site_source" AS ENUM('osm', 'wikidata', 'ssi');--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'site_import';--> statement-breakpoint
CREATE TABLE "dive_site_external_id" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" uuid NOT NULL,
	"source" "site_source" NOT NULL,
	"external_id" text NOT NULL,
	"provides_data" boolean DEFAULT false NOT NULL,
	"imported" jsonb,
	"site_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_site_external_id_imported_ck" CHECK ("dive_site_external_id"."provides_data" = ("dive_site_external_id"."imported" is not null))
);
--> statement-breakpoint
CREATE TABLE "site_import" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"started_by" uuid,
	"sources" jsonb NOT NULL,
	"area" jsonb NOT NULL,
	"language" text NOT NULL,
	"odbl_confirmed_at" timestamp with time zone,
	"status" "site_import_status" DEFAULT 'queued' NOT NULL,
	"progress" jsonb DEFAULT '{"step":"waiting","done":0,"total":0}'::jsonb NOT NULL,
	"counts" jsonb,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dive_site" ADD COLUMN "max_depth_m" double precision;--> statement-breakpoint
ALTER TABLE "dive_site_external_id" ADD CONSTRAINT "dive_site_external_id_site_id_dive_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."dive_site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_site_external_id" ADD CONSTRAINT "dive_site_external_id_site_import_id_site_import_id_fk" FOREIGN KEY ("site_import_id") REFERENCES "public"."site_import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_import" ADD CONSTRAINT "site_import_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_site_external_id_source_uq" ON "dive_site_external_id" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_site_external_id_site_source_uq" ON "dive_site_external_id" USING btree ("site_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "site_import_one_active_uq" ON "site_import" USING btree ((true)) WHERE "site_import"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "site_import_created_idx" ON "site_import" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "dive_site" ADD CONSTRAINT "dive_site_max_depth_ck" CHECK ("dive_site"."max_depth_m" > 0 and "dive_site"."max_depth_m" <= 400);