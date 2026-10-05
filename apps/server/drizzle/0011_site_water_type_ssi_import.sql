ALTER TABLE "dive_site_external_id" DROP CONSTRAINT "dive_site_external_id_imported_ck";--> statement-breakpoint
ALTER TABLE "dive_site" ADD COLUMN "water_type" "water_type";--> statement-breakpoint
ALTER TABLE "site_import" ADD COLUMN "ssi_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_import" ADD COLUMN "create_sites" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dive" DROP COLUMN "water_type";--> statement-breakpoint
ALTER TABLE "dive_site" ADD CONSTRAINT "dive_site_water_type_ck" CHECK ("dive_site"."water_type" in ('fresh', 'salt', 'brackish'));--> statement-breakpoint
ALTER TABLE "dive_site_external_id" ADD CONSTRAINT "dive_site_external_id_imported_ck" CHECK (not "dive_site_external_id"."provides_data" or "dive_site_external_id"."imported" is not null);