CREATE TYPE "public"."cylinder_material" AS ENUM('aluminium', 'steel', 'carbon');--> statement-breakpoint
CREATE TABLE "cylinder" (
	"dive_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"volume_l" real,
	"working_pressure_bar" real,
	"material" "cylinder_material",
	"o2" real,
	"he" real,
	"start_pressure_bar" real,
	"end_pressure_bar" real,
	"from_pod" boolean DEFAULT false NOT NULL,
	"recording_id" uuid,
	"channel" text,
	CONSTRAINT "cylinder_dive_id_position_pk" PRIMARY KEY("dive_id","position"),
	CONSTRAINT "cylinder_series_ck" CHECK (("cylinder"."recording_id" is null) = ("cylinder"."channel" is null)),
	CONSTRAINT "cylinder_gas_ck" CHECK (("cylinder"."o2" is null) = ("cylinder"."he" is null))
);
--> statement-breakpoint
ALTER TABLE "cylinder" ADD CONSTRAINT "cylinder_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cylinder" ADD CONSTRAINT "cylinder_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cylinder_recording_idx" ON "cylinder" USING btree ("recording_id");