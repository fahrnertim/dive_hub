-- The worker no longer reads earlier Recordings again at each start (positions, ADR 0020; gas consumption, ADR 0032;
-- Cylinders from tank pod data, ADR 0045): every instance has run those backfills since 2026-10-09. 0047 drops their
-- marker columns. An instance that still has a Recording whose positions were never read stops here instead of losing
-- them: it starts the version before this migration once, lets the worker finish, then upgrades.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "recording" WHERE "positions_read_at" IS NULL AND "deleted_at" IS NULL) THEN
    RAISE EXCEPTION 'Some Recordings still wait for their positions to be read: start the previous Dive Hub version once and let its worker finish, then upgrade';
  END IF;
END $$;--> statement-breakpoint
-- A backfill job still queued would find no task any more.
DO $$
BEGIN
  IF to_regnamespace('graphile_worker') IS NOT NULL THEN
    PERFORM graphile_worker.remove_job(k) FROM unnest(ARRAY['backfill_positions', 'backfill_gas_figures', 'fill_cylinders']) AS k;
  END IF;
END $$;
