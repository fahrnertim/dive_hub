---
title: "ADR 0014: Design system on React Aria, i18next localization, error codes, unit preferences"
summary: Own tokens and components on React Aria Components; English + German with i18next; the API sends error codes clients translate; metric/imperial is a per-User preference.
status: accepted
date: 2026-10-03
---

# ADR 0014: Design system on React Aria, i18next localization, error codes, unit preferences

## Status
Accepted – 2026-10-03. Surfaces and density amended by [ADR 0019](0019-tonal-surfaces.md) (2026-10-04): panels are
set off by tone, without outline; no component library or Tailwind.

## Context
After three slices the web client had about ten screens, roughly 150 hard-coded English strings,
ad hoc CSS variables and hand-built controls (a `div` with `role="button"` as drop zone). The API
returned English sentences that the client showed as they were. The logbook slices will add many
screens, and a dive log needs units: divers in the US use feet and °F regardless of language.
Retrofitting both later costs more with every screen. The project owner decided on 2026-10-03.

## Decision
- **Design system:** our own tokens (`apps/web/src/design/tokens.css`) and a small component set
  (`apps/web/src/ui/`) built on **React Aria Components**, which provide accessible behaviour without
  styling. No CSS framework. Direction, tokens and usage rules:
  [design system](../spec/design-system.md). Target: WCAG 2.2 AA, measured contrast.
- **Localization:** **i18next** + react-i18next, bundled JSON translations, typed keys. English is
  the source and fallback; **German** ships too (informal "du"). Language = User preference, else browser.
- **Error codes:** every API refusal is `{ code, error }`. `code` comes from one registry
  (`apps/server/src/http/problems.ts`) and is published as an enum in the OpenAPI document, so
  clients get it typed. Import outcomes carry `reason` codes; failed Imports carry `errorCode`.
  Fastify's own errors are mapped too (validation → `invalid_input` with its explanation; server
  errors → `internal_error` without internals).
- **Units:** values are stored in SI-based units and converted for display. Metric or imperial is a
  per-User preference (`user_preference` table, `PATCH /api/me/preferences`), separate from language;
  unset means the browser's region decides.
- **Pages that most visits don't need** (dive detail with the chart library, account, admin) are
  loaded on demand.

## Considered options
- **Plain HTML/CSS components.** Smallest bundle, but accessible dialogs, menus, comboboxes and
  date pickers would become our job as the app grows.
- **Mantine.** Fastest to build screens with, but larger, with its own look and conventions.
- **shadcn/ui + Tailwind.** Popular, but it brings Tailwind as the styling approach; tokens would
  live in its config. Checked again on 2026-10-04, including shadcn's new React Aria base, HeroUI v3 and
  Untitled UI ([UI component libraries](../research/2026-10-04-ui-component-libraries.md)): still Tailwind; not adopted.
- **English only for now.** Would have left the machinery untested; a second language proves it.
- **Units derived from language.** Rejected: a German diver may log in feet, and an English-speaking
  diver outside the US in metres.

## Consequences
- New screens use the components and tokens; new strings go into both translation files (tests
  enforce parity and that every API code has a text).
- Server texts change only in one place (`problems.ts`); clients don't parse English.
- About 60 kB (gzip) more for React Aria and i18next; page splitting keeps the first load at roughly
  180 kB (gzip) for all scripts.
- Data values from devices (e.g. water type "salt") are shown as recorded until they get translations.
