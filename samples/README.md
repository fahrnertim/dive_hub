---
title: Sample files
summary: Where real dive files go for development, and how they become committed test fixtures.
status: living
date: 2026-10-02
---

# Sample files

- **`samples/private/`** is git-ignored. Put real exports here (Garmin FIT, Export Original zips,
  account export zips, later Suunto). They contain GPS positions and personal data and must
  never be committed.
- **Committed fixtures** are derived from private samples: trimmed to what a test needs and
  anonymised (GPS removed or shifted, serial numbers and names replaced). Each fixture gets a
  line here saying what it covers.

## Wanted

| Case | Status |
|---|---|
| Garmin Descent, normal single-gas dive (Export Original zip) | have: Mk3, see [probe](../docs/research/2026-10-02-garmin-descent-sample-probe.md) |
| Same dive copied from the watch over USB (`GARMIN/Activity/*.fit`), to compare with Export Original | have: byte-identical to Export Original |
| Garmin account data export zip | parked: requested from Garmin later, takes time to arrive |
| Garmin Descent multi-gas dive | wanted (if available) |
| Garmin Descent with tank transmitter (tank pod) | later (no file yet) |
| Suunto FIT + JSON | later phase |

## Fixtures

_None yet._
