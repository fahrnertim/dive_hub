CREATE TABLE "diver_body_weight" (
	"diver_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kg" real NOT NULL,
	CONSTRAINT "diver_body_weight_diver_id_date_pk" PRIMARY KEY("diver_id","date"),
	CONSTRAINT "diver_body_weight_kg_ck" CHECK ("diver_body_weight"."kg" between 20 and 400)
);
--> statement-breakpoint
ALTER TABLE "diver_body_weight" ADD CONSTRAINT "diver_body_weight_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE cascade ON UPDATE no action;