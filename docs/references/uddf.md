---
title: UDDF (Universal Dive Data Format)
summary: Open XML exchange format for dive data; our baseline for data scope and an import/export format.
status: living
date: 2026-10-02
url: https://www.streit.cc/resources/UDDF/v3.2.3/en/index.html
---

# UDDF (Universal Dive Data Format)

## What it is
An open, free XML format for exchanging dive data (logs, profiles, equipment,
certifications, sites, trips, gases). Latest version 3.2.3, schema dated 2018-11-14.

- Documentation: <https://www.streit.cc/resources/UDDF/v3.2.3/en/index.html>
- Schema: <https://www.streit.cc/resources/UDDF/v3.2.3/schema/uddf_3.2.3.xsd>
- Homepage: <https://uddf.org/> (TLS certificate expired when checked on 2026-10-02)

## What we take from it
- Entity list as the **baseline scope** of Dive Hub's data model.
- Import/export format (one adapter among others).
- Not the internal model; see [UDDF gap analysis](../research/2026-10-02-uddf-gap-analysis.md).

## Notes
- SI units throughout; `ID`/`IDREF` only resolve within one file.
- Vendor extensions (`applicationdata`) are limited to five hard-coded vendors.
