CREATE TYPE "public"."push_run_item_state" AS ENUM('waiting', 'sending', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."push_run_status" AS ENUM('queued', 'running', 'done', 'cancelled', 'stopped');--> statement-breakpoint
CREATE TABLE "push_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"diver_id" uuid NOT NULL,
	"status" "push_run_status" DEFAULT 'queued' NOT NULL,
	"updates" boolean NOT NULL,
	"updates_removing_verification" boolean NOT NULL,
	"numbers" boolean DEFAULT false NOT NULL,
	"left_out" jsonb NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"stop_code" text,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_run_item" (
	"run_id" uuid NOT NULL,
	"dive_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action" text NOT NULL,
	"state" "push_run_item_state" DEFAULT 'waiting' NOT NULL,
	"outcome" text,
	"reason" text,
	"push_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "push_run_item_run_id_dive_id_pk" PRIMARY KEY("run_id","dive_id")
);
--> statement-breakpoint
ALTER TABLE "push_run" ADD CONSTRAINT "push_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_run" ADD CONSTRAINT "push_run_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_run" ADD CONSTRAINT "push_run_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_run_item" ADD CONSTRAINT "push_run_item_run_id_push_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."push_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_run_item" ADD CONSTRAINT "push_run_item_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_run_item" ADD CONSTRAINT "push_run_item_push_id_push_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."push"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_run_one_active_uq" ON "push_run" USING btree ("connection_id") WHERE "push_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "push_run_user_idx" ON "push_run" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "push_run_item_order_idx" ON "push_run_item" USING btree ("run_id","position");