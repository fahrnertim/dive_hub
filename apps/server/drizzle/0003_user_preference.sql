CREATE TYPE "public"."unit_system" AS ENUM('metric', 'imperial');--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"language" text,
	"units" "unit_system",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;