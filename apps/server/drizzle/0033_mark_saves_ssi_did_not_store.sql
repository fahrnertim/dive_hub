-- From about 2026-10-08 SSI answered a save from any client but its own app as done, with an invented dive ID, and stored
-- nothing (ADR 0049). Dive Hub recorded those Pushes as confirmed. They become failed Pushes with what happened as their
-- reason, so each Dive is again as its last real Push left it: "changed since sent", or not sent at all.
-- An update SSI stored answers with the dive's own ID, so another ID tells exactly; the Push gets the dive's ID back.
UPDATE "push" SET "state" = 'failed', "error_code" = 'provider_not_stored', "remote_id" = "payload"->>'odin_user_log_id'
WHERE "provider" = 'ssi' AND "action" = 'update' AND "state" = 'confirmed'
  AND "payload"->>'odin_user_log_id' IS NOT NULL AND "remote_id" IS NOT NULL AND "payload"->>'odin_user_log_id' <> "remote_id";--> statement-breakpoint
-- A create has no ID to compare: the invented ones have nine digits and start with 9 (SSI's own were at 29.8 million then),
-- and the dive was not found when read back. The Dive has no dive at SSI.
UPDATE "push" SET "state" = 'failed', "error_code" = 'provider_not_stored', "remote_id" = NULL, "remote_number" = NULL
WHERE "provider" = 'ssi' AND "action" = 'create' AND "state" = 'confirmed'
  AND "remote_id" ~ '^9[0-9]{8}$' AND "differences" IS NULL AND "created_at" >= '2026-10-08';
