CREATE TABLE "account_list_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_list_entry" ADD CONSTRAINT "account_list_entry_account_id_diver_external_id_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."diver_external_id"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_list_entry" ADD CONSTRAINT "account_list_entry_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_list_entry_diver_uq" ON "account_list_entry" USING btree ("account_id","diver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_list_entry_entry_uq" ON "account_list_entry" USING btree ("account_id","entry_id");--> statement-breakpoint
CREATE INDEX "account_list_entry_diver_idx" ON "account_list_entry" USING btree ("diver_id");