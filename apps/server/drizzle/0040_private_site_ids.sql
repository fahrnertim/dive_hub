DROP INDEX "dive_site_external_id_site_source_uq";--> statement-breakpoint
ALTER TABLE "dive_site_external_id" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "dive_site_external_id" ADD CONSTRAINT "dive_site_external_id_account_id_diver_external_id_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."diver_external_id"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_site_external_id_public_uq" ON "dive_site_external_id" USING btree ("site_id","source") WHERE "dive_site_external_id"."account_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_site_external_id_private_uq" ON "dive_site_external_id" USING btree ("site_id","source","account_id") WHERE "dive_site_external_id"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "dive_site_external_id_account_idx" ON "dive_site_external_id" USING btree ("account_id");