-- Leases in PostgreSQL (ADR 0027, amended): one action per Dive and Provider, and pacing per Connection, across app processes.
CREATE TABLE "dive_lease" (
	"dive_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"holder" uuid NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	CONSTRAINT "dive_lease_dive_id_provider_pk" PRIMARY KEY("dive_id","provider")
);
--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "next_action_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dive_lease" ADD CONSTRAINT "dive_lease_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;