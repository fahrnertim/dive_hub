-- Providers as adapters (ADR 0027). Hand-written: drizzle-kit asks interactively about renames; the snapshot was
-- edited to match, and `drizzle-kit generate` reports no changes afterwards.

-- Target becomes Provider, a text column the registry checks (a test-only adapter needs no enum value).
ALTER TABLE "connection" RENAME COLUMN "target" TO "provider";--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "provider" SET DATA TYPE text USING "provider"::text;--> statement-breakpoint
ALTER TABLE "push" RENAME COLUMN "target" TO "provider";--> statement-breakpoint
ALTER TABLE "push" ALTER COLUMN "provider" SET DATA TYPE text USING "provider"::text;--> statement-breakpoint
DROP TYPE "public"."target";--> statement-breakpoint
ALTER INDEX "connection_user_diver_target_uq" RENAME TO "connection_user_diver_provider_uq";--> statement-breakpoint

-- One sealed field by sign-in kind. The old token and password can't be re-sealed in SQL (the key lives only in
-- DIVEHUB_ENCRYPTION_KEY), so existing Connections sign in again once; the owner accepted this.
ALTER TABLE "connection" RENAME COLUMN "account_email" TO "account_label";--> statement-breakpoint
ALTER TABLE "connection" DROP CONSTRAINT "connection_password_ck";--> statement-breakpoint
ALTER TABLE "connection" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "connection" DROP COLUMN "password";--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "credentials" text;--> statement-breakpoint
UPDATE "connection" SET "state" = 'needs_sign_in', "keep_signed_in" = false;--> statement-breakpoint

-- "Gone from the Provider" is its own flag, no longer a failure code standing in for a state.
ALTER TABLE "push" ADD COLUMN "remote_gone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "push" SET "remote_gone" = true WHERE "error_code" = 'ssi_dive_gone';--> statement-breakpoint
UPDATE "push" SET "error_code" = NULL WHERE "error_code" = 'ssi_dive_gone' AND "state" = 'confirmed';--> statement-breakpoint

-- Stored failure codes follow the generic problem codes.
UPDATE "push" SET "error_code" = CASE "error_code"
  WHEN 'ssi_site_missing' THEN 'provider_site_id_missing'
  ELSE 'provider_' || substr("error_code", 5)
END WHERE "error_code" LIKE 'ssi\_%';
