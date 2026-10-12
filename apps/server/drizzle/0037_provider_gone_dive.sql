CREATE TABLE "provider_gone_dive" (
	"dive_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"remote_id" text NOT NULL,
	"remote_number" integer,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_gone_dive_dive_id_provider_pk" PRIMARY KEY("dive_id","provider")
);
--> statement-breakpoint
ALTER TABLE "provider_gone_dive" ADD CONSTRAINT "provider_gone_dive_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_gone_dive" ADD CONSTRAINT "provider_gone_dive_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_gone_dive_connection_idx" ON "provider_gone_dive" USING btree ("connection_id");