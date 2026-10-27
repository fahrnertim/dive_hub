CREATE TYPE "public"."waiting_push_action" AS ENUM('send', 'delete');--> statement-breakpoint
CREATE TYPE "public"."waiting_push_state" AS ENUM('waiting', 'held', 'stopped');--> statement-breakpoint
CREATE TABLE "waiting_push" (
	"dive_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"action" "waiting_push_action" NOT NULL,
	"state" "waiting_push_state" DEFAULT 'waiting' NOT NULL,
	"reason" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detail" jsonb,
	"due_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiting_push_dive_id_provider_pk" PRIMARY KEY("dive_id","provider")
);
--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "send_changes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "send_new_dives" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "delete_at_provider" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "fetch_every_minutes" integer;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "last_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "last_fetch_import_id" uuid;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "unsent_import_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "waiting_push" ADD CONSTRAINT "waiting_push_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_push" ADD CONSTRAINT "waiting_push_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiting_push_due_idx" ON "waiting_push" USING btree ("connection_id","state","due_at");--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_last_fetch_import_id_import_id_fk" FOREIGN KEY ("last_fetch_import_id") REFERENCES "public"."import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_fetch_every_ck" CHECK ("connection"."fetch_every_minutes" in (60, 360, 1440));