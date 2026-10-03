-- Custom migration (ADR 0008, 0015), reviewed. Converts data stored before migration 0004.
-- It was first appended to 0004, but development servers had already applied 0004 without it, and
-- an applied migration never runs again; so it lives here. Every statement only touches rows still
-- in the old form, so running it on a database that never saw the old form changes nothing.
--
-- 1. Recording summaries hold Garmin's FIT words. Map them to our vocabulary; anything without a
--    word moves to summary.extras under its source field name, as the FIT adapter does from now on.
UPDATE "recording" SET "summary" = CASE
    WHEN "summary"->>'diveMode' IN ('single_gas_diving', 'multi_gas_diving') THEN jsonb_set("summary", '{diveMode}', '"open_circuit"')
    WHEN "summary"->>'diveMode' = 'gauge_diving' THEN jsonb_set("summary", '{diveMode}', '"gauge"')
    WHEN "summary"->>'diveMode' = 'ccr_diving' THEN jsonb_set("summary", '{diveMode}', '"ccr"')
    WHEN "summary"->>'diveMode' IN ('apnea_diving', 'apnea_hunting', 'dynamic_apnea') THEN jsonb_set("summary", '{diveMode}', '"apnea"')
    ELSE ("summary" - 'diveMode') || jsonb_build_object('extras', coalesce("summary"->'extras', '{}'::jsonb) || jsonb_build_object('sub_sport', "summary"->>'diveMode'))
  END
  WHERE "summary" ? 'diveMode' AND "summary"->>'diveMode' NOT IN ('open_circuit', 'ccr', 'scr', 'gauge', 'apnea');--> statement-breakpoint
UPDATE "recording" SET "summary" = CASE
    WHEN "summary"->>'decoModel' = 'zhl16c' THEN jsonb_set("summary", '{decoModel}', '"buhlmann_zhl16c"')
    ELSE ("summary" - 'decoModel') || jsonb_build_object('extras', coalesce("summary"->'extras', '{}'::jsonb) || jsonb_build_object('dive_settings.model', "summary"->>'decoModel'))
  END
  WHERE "summary" ? 'decoModel' AND "summary"->>'decoModel' <> 'buhlmann_zhl16c';--> statement-breakpoint
UPDATE "recording" SET "summary" = ("summary" - 'waterType')
    || jsonb_build_object('extras', coalesce("summary"->'extras', '{}'::jsonb) || jsonb_build_object('dive_settings.water_type', "summary"->>'waterType'))
  WHERE "summary" ? 'waterType' AND "summary"->>'waterType' NOT IN ('fresh', 'salt', 'brackish', 'en13319', 'custom');--> statement-breakpoint
-- Gas "mode" becomes "circuit"; an unknown mode is dropped (the gas itself stays).
UPDATE "recording" SET "summary" = jsonb_set("summary", '{gases}', (
    SELECT coalesce(jsonb_agg(CASE g->>'mode'
        WHEN 'open_circuit' THEN (g - 'mode') || '{"circuit": "open_circuit"}'::jsonb
        WHEN 'closed_circuit_diluent' THEN (g - 'mode') || '{"circuit": "diluent"}'::jsonb
        ELSE g - 'mode' END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements("summary"->'gases') WITH ORDINALITY AS t(g, ord)))
  WHERE jsonb_typeof("summary"->'gases') = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements("summary"->'gases') AS g WHERE g ? 'mode');--> statement-breakpoint
-- 2. Water temperature and type of each Dive come from its Primary recording, unless the User set them.
UPDATE "dive" AS d SET "water_temperature_c" = (r."summary"->>'minTemperatureC')::real
  FROM "recording" AS r
  WHERE r."id" = d."primary_recording_id" AND d."water_temperature_c" IS NULL
    AND NOT ('waterTemperatureC' = ANY(d."overrides")) AND r."summary" ? 'minTemperatureC';--> statement-breakpoint
UPDATE "dive" AS d SET "water_type" = (r."summary"->>'waterType')::"water_type"
  FROM "recording" AS r
  WHERE r."id" = d."primary_recording_id" AND d."water_type" IS NULL
    AND NOT ('waterType' = ANY(d."overrides"))
    AND r."summary"->>'waterType' IN ('fresh', 'salt', 'brackish', 'en13319', 'custom');
