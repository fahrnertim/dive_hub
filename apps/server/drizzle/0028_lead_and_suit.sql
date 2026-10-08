CREATE TYPE "public"."lead_placement" AS ENUM('belt', 'integrated', 'trim', 'ankle', 'backplate', 'other');--> statement-breakpoint
CREATE TYPE "public"."suit_type" AS ENUM('none', 'skin', 'wetsuit', 'semidry', 'drysuit');--> statement-breakpoint
CREATE TYPE "public"."suit_undergarment" AS ENUM('light', 'medium', 'heavy');--> statement-breakpoint
CREATE TYPE "public"."weighting_felt" AS ENUM('right', 'too_heavy', 'too_light');--> statement-breakpoint
CREATE TABLE "lead" (
	"dive_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"amount_kg" real NOT NULL,
	"placement" "lead_placement",
	CONSTRAINT "lead_dive_id_position_pk" PRIMARY KEY("dive_id","position"),
	CONSTRAINT "lead_amount_ck" CHECK ("lead"."amount_kg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "weighting_felt" "weighting_felt";--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "weighting_amount_kg" real;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "suit_type" "suit_type";--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "suit_thickness_mm" real;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "suit_hood" boolean;--> statement-breakpoint
ALTER TABLE "dive" ADD COLUMN "suit_undergarment" "suit_undergarment";--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;