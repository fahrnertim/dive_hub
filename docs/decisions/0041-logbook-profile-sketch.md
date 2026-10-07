---
title: "ADR 0041: The profile sketch in the logbook"
summary: The dive assessment row stores a 48-point reduced depth profile of the Primary recording; GET /api/dives sends it as `profile` with the ascent bands, and the logbook row draws it on one depth scale.
status: accepted
date: 2026-10-07
---

# ADR 0041: The profile sketch in the logbook

## Status
Accepted – 2026-10-07. Extends [ADR 0040](0040-logbook-rows-and-filters.md) and [ADR 0036](0036-dive-assessment.md).

## Context
Slice D of the [UI redesign](../research/2026-10-07-ui-redesign-proposal.md) (3.1): a row shows the shape of the dive
(sawtooth, square, multilevel) before any number is read. The list had no samples, and reading a Primary recording's
full series for 25 rows per request is far too much.

## Decision
- **Stored with the assessment**, in `dive_assessment.profile` (jsonb, nullable): 48 depths in metres to a decimetre,
  evenly spread over the Recording's depth samples, each the **deepest sample of its stretch** (peaks survive; a stretch
  without a sample keeps the last depth), and `spanSeconds`. `src/assessment/sketch.ts`. Null under two samples or
  never below 1 m.
- It follows the assessment's freshness (engine version, Primary recording, its `updated_at`), so a re-import or a new
  Primary recording refreshes it. It is filled for every Dive with a depth series, **also those the rules don't
  cover** (apnea, rebreathers).
- **`ENGINE_VERSION` goes to 2** only to make the existing Dives catch up: the start-up `refreshAll` fills them, so
  there is no data migration beyond the column (`0022_dive_profile_sketch.sql`). The findings come out the same.
- **API:** each Dive of `GET /api/dives` gains `profile: { depthsM, spanSeconds, ascentBands } | null` (the bands as
  in ADR 0036, in seconds from the first sample). Null for a Dive without a Recording, with nothing to draw, or while
  its assessment is of another recording than the Primary one (not yet caught up): a client never shows another
  recording's sketch. Additive.
- **Drawing (web):** a 112 × 40 box per row, the same depth scale for every row (the logbook's deepest dive, at least
  10 m, from `totals.deepestM`), the depth gradient, fast ascent over it in its colour and thicker. Decoration
  (`aria-hidden`): depth and duration are text beside it. A Dive without a Recording has an empty dashed box (its row
  says "No recording"). On a phone it is a column of its own, and a line of its own below 26 rem of list width.

## Consequences
- One more indexed query per list request (by Dive id). About 1 KB per Dive in the response (25 rows: about 25 KB).
- Not in this change: the sketch on the Review page (4.5). Its candidates are Recordings and pairs of Dives, whose
  views have no profile yet.
- A new duty for clients: [client contract](../spec/clients.md#dives).
