CREATE TABLE "provider_site_data" (
	"provider" text PRIMARY KEY NOT NULL,
	"allowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allowed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "provider_site_data" ADD CONSTRAINT "provider_site_data_allowed_by_user_id_fk" FOREIGN KEY ("allowed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;