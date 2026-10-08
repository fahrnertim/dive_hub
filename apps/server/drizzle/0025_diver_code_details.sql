ALTER TABLE "diver" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "diver" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "diver" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "diver" ADD COLUMN "leader_number" text;--> statement-breakpoint
ALTER TABLE "diver" ADD CONSTRAINT "diver_code_parts_ck" CHECK ("diver"."first_name" ~ '^[^\x3B\r\n]{1,100}$' and "diver"."last_name" ~ '^[^\x3B\r\n]{1,100}$' and "diver"."email" ~ '^[^\x3B\s]{3,254}$' and "diver"."leader_number" ~ '^[^\x3B\s]{1,20}$');