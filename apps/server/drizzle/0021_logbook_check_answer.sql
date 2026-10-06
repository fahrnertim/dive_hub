CREATE TABLE "logbook_check_answer" (
	"rule" text NOT NULL,
	"dive_a" uuid NOT NULL,
	"dive_b" uuid NOT NULL,
	"starts_a" timestamp with time zone NOT NULL,
	"starts_b" timestamp with time zone NOT NULL,
	"answered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logbook_check_answer_dive_a_dive_b_pk" PRIMARY KEY("dive_a","dive_b")
);
--> statement-breakpoint
ALTER TABLE "logbook_check_answer" ADD CONSTRAINT "logbook_check_answer_dive_a_dive_id_fk" FOREIGN KEY ("dive_a") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_check_answer" ADD CONSTRAINT "logbook_check_answer_dive_b_dive_id_fk" FOREIGN KEY ("dive_b") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_check_answer" ADD CONSTRAINT "logbook_check_answer_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logbook_check_answer_b_idx" ON "logbook_check_answer" USING btree ("dive_b");