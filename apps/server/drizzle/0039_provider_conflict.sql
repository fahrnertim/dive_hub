CREATE TABLE "provider_conflict" (
	"dive_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"remote_id" text NOT NULL,
	"fields" jsonb NOT NULL,
	"run_id" uuid,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_conflict_dive_id_provider_pk" PRIMARY KEY("dive_id","provider")
);
--> statement-breakpoint
ALTER TABLE "provider_conflict" ADD CONSTRAINT "provider_conflict_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_conflict" ADD CONSTRAINT "provider_conflict_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_conflict" ADD CONSTRAINT "provider_conflict_run_id_push_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."push_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_conflict_connection_idx" ON "provider_conflict" USING btree ("connection_id");