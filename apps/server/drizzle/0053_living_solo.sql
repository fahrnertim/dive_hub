CREATE TABLE "continuation_append" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"joined_recording_id" uuid NOT NULL,
	"kept_dive_id" uuid NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recording" ALTER COLUMN "original_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ALTER COLUMN "import_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "joined_recording_id" uuid;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "append_id" uuid;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "from_dive_id" uuid;--> statement-breakpoint
ALTER TABLE "continuation_append" ADD CONSTRAINT "continuation_append_joined_recording_id_recording_id_fk" FOREIGN KEY ("joined_recording_id") REFERENCES "public"."recording"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuation_append" ADD CONSTRAINT "continuation_append_kept_dive_id_dive_id_fk" FOREIGN KEY ("kept_dive_id") REFERENCES "public"."dive"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuation_append" ADD CONSTRAINT "continuation_append_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_joined_recording_id_recording_id_fk" FOREIGN KEY ("joined_recording_id") REFERENCES "public"."recording"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_append_id_continuation_append_id_fk" FOREIGN KEY ("append_id") REFERENCES "public"."continuation_append"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_from_dive_id_dive_id_fk" FOREIGN KEY ("from_dive_id") REFERENCES "public"."dive"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_joined_idx" ON "recording" USING btree ("joined_recording_id");--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_derived_ck" CHECK (("recording"."parser" = 'continuation') = ("recording"."original_id" is null and "recording"."import_id" is null));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_part_ck" CHECK (("recording"."joined_recording_id" is null) = ("recording"."append_id" is null) and ("recording"."append_id" is null) = ("recording"."from_dive_id" is null));