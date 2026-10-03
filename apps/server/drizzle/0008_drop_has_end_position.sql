-- Positions are columns on the Recording now (ADR 0020); the flag that one existed goes.
-- Existing Recordings get their positions from the background backfill, which re-reads their Originals.
UPDATE "recording" SET "summary" = "summary" - 'hasEndPosition' WHERE "summary" ? 'hasEndPosition';
