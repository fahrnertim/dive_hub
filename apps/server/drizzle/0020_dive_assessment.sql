CREATE TYPE "public"."finding_severity" AS ENUM('info', 'note', 'caution');--> statement-breakpoint
CREATE TABLE "dive_assessment" (
	"dive_id" uuid PRIMARY KEY NOT NULL,
	"engine_version" integer NOT NULL,
	"recording_id" uuid,
	"recording_stamp" timestamp with time zone,
	"applies" boolean NOT NULL,
	"entered_deco" boolean DEFAULT false NOT NULL,
	"sample_interval_s" real,
	"ascent_bands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dive_finding" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dive_id" uuid NOT NULL,
	"recording_id" uuid,
	"rule" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"start_s" real,
	"end_s" real,
	"values" jsonb NOT NULL,
	"engine_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_dismissal" (
	"dive_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"dismissed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_dismissal_dive_id_rule_pk" PRIMARY KEY("dive_id","rule")
);
--> statement-breakpoint
CREATE TABLE "muted_rule" (
	"diver_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"muted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "muted_rule_diver_id_rule_pk" PRIMARY KEY("diver_id","rule")
);
--> statement-breakpoint
ALTER TABLE "dive_assessment" ADD CONSTRAINT "dive_assessment_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_finding" ADD CONSTRAINT "dive_finding_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_dismissal" ADD CONSTRAINT "finding_dismissal_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_dismissal" ADD CONSTRAINT "finding_dismissal_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muted_rule" ADD CONSTRAINT "muted_rule_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muted_rule" ADD CONSTRAINT "muted_rule_muted_by_user_id_fk" FOREIGN KEY ("muted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_finding_dive_rule_uq" ON "dive_finding" USING btree ("dive_id","rule");