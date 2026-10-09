-- Dive numbers are computed now (ADR 0048): a typed number is no Override any more, and every Diver's Dives are numbered
-- by start time (deleted ones and, for a Diver who doesn't count them, apnea sessions get none).
UPDATE "dive" SET "overrides" = array_remove("overrides", 'number') WHERE 'number' = ANY("overrides");--> statement-breakpoint
WITH numbered AS (
  SELECT d.id,
         CASE WHEN d.deleted_at IS NULL AND (dv.apnea_counts OR coalesce(r.summary->>'diveMode', '') <> 'apnea')
           THEN dv.dives_before + row_number() OVER (
             PARTITION BY d.diver_id,
               (d.deleted_at IS NULL AND (dv.apnea_counts OR coalesce(r.summary->>'diveMode', '') <> 'apnea'))
             ORDER BY d.starts_at, d.id)
         END AS n
  FROM dive d
  JOIN diver dv ON dv.id = d.diver_id
  LEFT JOIN recording r ON r.id = d.primary_recording_id
)
UPDATE dive d SET number = numbered.n FROM numbered
WHERE d.id = numbered.id AND d.number IS DISTINCT FROM numbered.n;
