---
title: DiveJSON
summary: New (2026) draft JSON Schema for dive logs with detailed mappings of UDDF, FIT, Subsurface and Suunto quirks.
status: living
date: 2026-10-02
url: https://github.com/divejson/divejson
---

# DiveJSON

## What it is
A draft JSON Schema for dive logs (spec CC BY 4.0, schema MIT). It comes with fixtures, a
validator CLI and mapping docs for UDDF, FIT, SSRF and Suunto JSON/XML. The repo was created
2026-08-28; it has had almost no adoption so far. Reference implementation: OpenDiving
(<https://github.com/opendiving/opendiving-api>).

## What we take from it
- Mapping docs (`docs/*-mapping.md`) as the most detailed public write-up of
  real-world format quirks.
- Candidate interchange or export format if it gains traction.

## Notes
- Watch, don't depend on it yet.
