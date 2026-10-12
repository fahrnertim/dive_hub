ALTER TABLE "push_run" ADD COLUMN "numbers_removing_verification" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "push_run_item" ADD COLUMN "shares_with_dive_id" uuid;--> statement-breakpoint
ALTER TABLE "push_run_item" ADD CONSTRAINT "push_run_item_shares_with_dive_id_dive_id_fk" FOREIGN KEY ("shares_with_dive_id") REFERENCES "public"."dive"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "push_run" SET "left_out" = "left_out" || '{"numberHeldAtProvider":0}'::jsonb;
