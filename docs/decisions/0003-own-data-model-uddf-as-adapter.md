---
title: "ADR 0003: Own data model; UDDF as baseline scope and import/export format"
summary: Dive Hub has its own internal data model. UDDF defines the minimum scope and is one import/export adapter, not the storage model.
status: accepted
date: 2026-10-02
---

# ADR 0003: Own data model; UDDF as baseline scope and import/export format

## Status
Accepted – 2026-10-02

## Context
Dive Hub needs a data model for dives and everything around them (people,
certifications, equipment, sites, trips). UDDF 3.2.3 is the only
vendor-neutral standard that covers this whole area, so it was the obvious candidate for
the internal model ([spec](../spec/README.md), open question "Data model").

The [UDDF gap analysis](../research/2026-10-02-uddf-gap-analysis.md) shows:
- UDDF is a **file format, not a system model**. It has one owner per document, IDs
  that are only valid within one file, no provenance, one profile per dive, no change
  tracking and no sync state (gaps A1–A6). A multi-user hub that pulls from several
  sources and pushes to several targets needs every one of these.
- The format has been **frozen since 2018**, its extension point allows only five
  hard-coded vendors (A7), and real-world files come in incompatible dialects.
- **Our first sources don't speak UDDF.** Garmin and Suunto deliver FIT (plus Suunto
  JSON) ([dive data sources](../research/2026-10-02-dive-data-sources.md)). FIT dive
  messages and libdivecomputer's parser model carry fields UDDF has no place for
  (SAC/RMV, TTS, tank pods, water type, GF, location).

## Decision
1. **Dive Hub has its own internal data model**, described in the
   [data model spec](../spec/data-model.md) and named in the [glossary](../glossary.md).
2. **UDDF's entity list is the baseline scope.** Every UDDF section is either covered
   by the model or explicitly listed as out of scope or later. UDDF is the checklist,
   not the shape.
3. **UDDF is one import/export adapter among others** (FIT, Suunto JSON, Subsurface).
   The reader is lenient: it accepts any namespace, ignores element order and doesn't
   depend on XSD validation. The writer maps losslessly wherever UDDF has a place for a value.
4. **Field coverage**: sample and summary fields are the union of libdivecomputer's
   parser model and Garmin FIT dive messages.
5. **Structure ideas from Subsurface**: several dive computers per dive (our
   *Recordings*), cylinders, weight systems and sensor-to-cylinder mapping.
6. **Originals are kept.** Every file or payload received from a Source is stored
   unchanged next to the Recordings made from it, so it can be re-parsed later and
   nothing is lost in the mapping.
7. **Hub concerns UDDF lacks are first-class**: users and the Divers they manage,
   global identifiers plus external source IDs, provenance per Recording and per change,
   several Recordings per Dive, Revisions, Push state per Target, Visibility and Signatures.

## Considered options
- **UDDF as the internal model, with extensions.** Rejected: A1–A6 would need to be
  added outside the schema anyway, and `applicationdata` doesn't allow our own
  namespace, so the result would no longer be UDDF.
- **DiveJSON as the internal model.** Rejected for now. It's a draft from 2026-08 with no
  adoption. We'll watch it as a possible export format; its mapping docs are a reference.
- **Subsurface's model.** Rejected. It's a single-user desktop model with no spec beyond the
  code. We borrow its structure ideas instead.

## Consequences
- We own a schema and its migrations, and every Source/Target needs a mapping
  (an adapter). Gaps A1–A8 and B1–B16 can be closed without fighting a format.
- UDDF export may be lossy for hub-only data (Revisions, Pushes, several Recordings).
  This is acceptable because Exports are for moving data elsewhere, not for backup.
  A full-fidelity backup format is a separate decision.
- Storing Originals costs disk space but makes better parsers a re-import, not data loss.
- When a Source changes its format, only its adapter changes, not the core model.
