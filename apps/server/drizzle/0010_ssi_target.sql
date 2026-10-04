CREATE TYPE "public"."connection_state" AS ENUM('active', 'needs_sign_in');--> statement-breakpoint
CREATE TYPE "public"."diver_source" AS ENUM('ssi', 'padi');--> statement-breakpoint
CREATE TYPE "public"."push_action" AS ENUM('create', 'update', 'link', 'delete');--> statement-breakpoint
CREATE TYPE "public"."push_mode" AS ENUM('api', 'qr');--> statement-breakpoint
CREATE TYPE "public"."push_state" AS ENUM('pending', 'handed_over', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."target" AS ENUM('ssi');--> statement-breakpoint
CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"target" "target" NOT NULL,
	"account_id" text NOT NULL,
	"account_email" text NOT NULL,
	"keep_signed_in" boolean NOT NULL,
	"token" text,
	"password" text,
	"state" "connection_state" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_password_ck" CHECK ("connection"."password" is null or "connection"."keep_signed_in")
);
--> statement-breakpoint
CREATE TABLE "diver_external_id" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"diver_id" uuid NOT NULL,
	"source" "diver_source" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dive_id" uuid NOT NULL,
	"connection_id" uuid,
	"user_id" uuid,
	"target" "target" NOT NULL,
	"mode" "push_mode" NOT NULL,
	"action" "push_action" NOT NULL,
	"state" "push_state" NOT NULL,
	"remote_id" text,
	"remote_number" integer,
	"remote_reference" text,
	"dive_version" integer NOT NULL,
	"fingerprint" text,
	"payload" jsonb,
	"differences" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diver_external_id" ADD CONSTRAINT "diver_external_id_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push" ADD CONSTRAINT "push_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push" ADD CONSTRAINT "push_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push" ADD CONSTRAINT "push_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_user_diver_target_uq" ON "connection" USING btree ("user_id","diver_id","target");--> statement-breakpoint
CREATE UNIQUE INDEX "diver_external_id_source_uq" ON "diver_external_id" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diver_external_id_diver_source_uq" ON "diver_external_id" USING btree ("diver_id","source");--> statement-breakpoint
CREATE INDEX "push_dive_idx" ON "push" USING btree ("dive_id","created_at");