---
title: Oceanic+ import - confirm the UDDF reader on real files, then the cloud API
summary: The UDDF adapter reads the Oceanic+ logbook export from one public, sanitised sample; check it against the owner's Apple Watch Ultra exports, then decide on an Oceanic+ Provider over its private cloud API.
status: draft
risk: medium
date: 2026-11-03
---

# Oceanic+ import - real files, then the cloud API

## Goal
1. **Files (started 2026-11-03, branch `oceanic-plus-uddf-import`):** UDDF import with the Oceanic+ dialect
   ([reference](../references/oceanic-plus.md)). Done when the owner's exports in `samples/private/oceanic-plus/`
   pass `apps/server/test/uddf-format.test.ts`, and each open point in the reference is answered there.
2. **API (later):** an import-only Oceanic+ Provider like Garmin's (ADR 0062), if the cloud API can be used. Needs a
   research note and the owner's decision first: the API is private and not documented.

## Read first
- [references/oceanic-plus.md](../references/oceanic-plus.md) and the [research note](../research/2026-11-03-oceanic-plus-uddf.md).
- ADR 0003 (UDDF as a lenient adapter), ADR 0037 (file formats as adapters), ADR 0062 (Garmin, import-only Provider).

## Open for the owner
- Real exports from the Apple Watch Ultra (several dives; ideally one with a gas switch and one with a site name).
- Where the export is in the app (for the import page's "Where to find your dives").

## Don't
- Commit real exports or the GPL sample; derive anonymised fixtures (samples/README.md).
