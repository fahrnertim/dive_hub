---
title: "ADR 0015: Overrides as marked fields, optimistic locking, our own device vocabulary, browser tests"
summary: A Dive's recording-derived columns hold the value in effect plus a set of overridden field names; edits name the version they started from; device values are mapped to our vocabulary; Playwright tests the web client in a real browser.
status: accepted
date: 2026-10-03
---

# ADR 0015: Overrides as marked fields, optimistic locking, our own device vocabulary, browser tests

## Status
Accepted – 2026-10-03

## Context
Slice 5 makes the dive page the place to keep a Dive: setting values by hand (**Overrides**, as the
[data model](../spec/data-model.md) defines them), choosing the **Primary recording**, and seeing
the **Revisions**. Device values such as the water type were Garmin's raw words, so nothing could
translate them, and every new Source would bring its own words. Slice 4's screenshots found
three bugs that type checks and unit tests had missed. The project owner chose on 2026-10-03:
derived values plus notes are editable, editing happens in an edit mode, browser tests are added.

## Decision
- **Overrides as marked fields.** The Dive keeps one column per recording-derived value (number,
  start + UTC offset, duration, max/avg depth, water temperature, water type) holding the value
  **in effect**, plus `overrides`: the names of the fields the User set by hand. Values not in
  `overrides` are recomputed from the Primary recording whenever it changes (the User switches it,
  or a re-import updates it); overridden values stay. Resetting a field removes it from the set and
  takes the recording's value. One value per field, sortable lists, no copies to keep in sync.
- **Notes** are the Dive's own field, not an Override.
- **Every change is one Revision** with the changed fields (`from`/`to`), the change of `overrides`
  and the cause (`import-create`, `auto-attach`, `reimport`, `edit`, `primary-change`). An edit that
  changes nothing writes nothing.
- **Optimistic locking.** A Dive has a `version` that grows with every change. Edits and Primary
  switches send the version they started from; a different current version answers 409
  `dive_changed`, and the web client offers to reload instead of overwriting.
- **Our own device vocabulary** (`apps/server/src/vocabulary.ts`): water type, dive mode,
  deco model, gas circuit, following UDDF where it has a term (ADR 0003). Each Source adapter maps
  its words (FIT: `fit-vocabulary.ts`, checked against Garmin's FIT profile and the real Descent Mk3
  samples). A value without a word is kept in `summary.extras` under its source field name, never
  guessed. The API publishes the lists as enums; clients translate them. Stored summaries are
  converted by `0005_vocabulary_data`.
- **Applied migrations are never edited.** The data step was first appended to `0004`, but a dev
  server had already applied `0004` as generated, so it never ran there and summaries stayed in
  Garmin's words. It moved to its own migration, written to be safe to run on any database. The
  server now compares applied migrations with their files at start and logs an error on a mismatch.
- **Nullable request fields list `null` first.** Fastify's validator coerces types and tries union
  members in order; with the value type first, `null` became `0` or `""`. The browser tests found it.
- **Browser tests with Playwright** (`apps/web/e2e`) against the real server, a fresh database and
  the built web client, using the installed Edge or Chrome (no browser download). They cover the
  dive page's main flows in English and German. The `playwright-cli` skill helps write and debug them.

## Considered options
- **Overrides in a separate table or JSON map, effective value computed on read.** Keeps the
  recording's value and the User's apart, but every list and sort needs the merge; we can read the
  recording's value from the Primary recording when needed (the API's `fromRecording`).
- **Inline editing per value** (rejected by the owner): many small Revisions and more requests.
- **Last write wins.** Simpler, but silently drops a change made on another device.
- **Translating each Source's raw words in the client.** Grows with every Source; clients would
  need to know Source vocabularies.

## Consequences
- Code that changes a Dive's Primary recording or its data must call the shared refresh
  (`refreshFromPrimary`) so non-overridden values follow.
- A future sync API and mobile client get conflict detection for free through `version`.
- New Sources need a mapping to the vocabulary; unmapped values stay visible as "other values from
  the device" instead of disappearing.
- `pnpm --filter @dive-hub/web test:e2e` needs PostgreSQL and an installed Edge/Chrome; it is not
  part of `pnpm test`. CI will need a browser (install or channel).
