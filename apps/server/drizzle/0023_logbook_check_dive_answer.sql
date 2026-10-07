CREATE TABLE "logbook_check_dive_answer" (
	"dive_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"duration_seconds" real NOT NULL,
	"max_depth_m" real,
	"answered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logbook_check_dive_answer_dive_id_rule_pk" PRIMARY KEY("dive_id","rule")
);
--> statement-breakpoint
ALTER TABLE "logbook_check_dive_answer" ADD CONSTRAINT "logbook_check_dive_answer_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_check_dive_answer" ADD CONSTRAINT "logbook_check_dive_answer_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;