---
title: divetracx
summary: MIT-licensed self-hosted dive log; closest existing project to Dive Hub.
status: living
date: 2026-10-02
url: https://github.com/michidk/divetracx
---

# divetracx

## What it is
MIT-licensed, self-hosted dive log. Imports DiveMate, Subsurface and Garmin (pulls
original FIT files using the user's Garmin Connect login) and exports UDDF 3.2.3.

## What we take from it
- Prior art to study before designing ingestion and the data model.
- Possible source of reusable parsing or mapping code (MIT).

## Notes
- Not yet reviewed in depth.
- Its Garmin login approach depends on unofficial access, which broke for other tools in 2026.
