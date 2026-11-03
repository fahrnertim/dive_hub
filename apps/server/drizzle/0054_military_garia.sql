CREATE TABLE "provider_lease" (
	"key" text PRIMARY KEY NOT NULL,
	"holder" uuid NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);
