---
title: Documentation index
summary: Map of all project knowledge. One line per document.
status: living
date: 2026-10-05
---

# Documentation index

Keep this list complete: add a line when a doc is created, remove it when deleted.

## Spec
- [spec/README.md](spec/README.md) — Product specification: vision, sources → hub → targets, later features (auto-import of sites near imported Dives), open questions.
- [spec/data-model.md](spec/data-model.md) — Entities, ownership, relationships; UDDF checklist, gap coverage, scenarios.
- [spec/architecture.md](spec/architecture.md) — Components, import flow, Docker Compose deployment, auth; implementation status per slice (9: merging sites, paged site list, client contract); operator notes on site data licenses; slice 10: sending Dives to SSI, `DIVEHUB_ENCRYPTION_KEY`; slice 11: SSI site import, offers, water type on the site; operator notes on SSI's missing licence.
- [spec/clients.md](spec/clients.md) — Client contract: what every API client must do, from a walk through the web client (licenses, privacy, security, confirmations, versions, each area's duties, units, accessibility); SSI import confirmation, offers, the water mismatch hint, the site form's water type note; two server gaps found and fixed.
- [spec/design-system.md](spec/design-system.md) — Visual direction, tokens, components, writing, localization, units, accessibility.

## Glossary
- [glossary.md](glossary.md) — Domain language with German UI words: User, Admin, Invitation, Password reset link, Disabled, Diver, Dive, Recording, Dive site, water type of a site vs the computer's water setting, Merge, Position, Source, External ID, Attribution, Offer, Site import, Import, Push, …

## Development
- [development.md](development.md) — setup, layout, common tasks (incl. SSI's hand-made site list for tests), tooling notes.

## Agent skills
- [skills.md](skills.md) — installed agent skills, rejected candidates, how to vet and install.

## Sample files
- [../samples/README.md](../samples/README.md) — where real dive files go (`samples/private/`, git-ignored) and how fixtures are derived.

## Decisions (ADRs)
- [0001 All project knowledge lives in this repository](decisions/0001-all-project-knowledge-in-repo.md) — no local/account memory; enforcement layers.
- [0002 Knowledge base structure](decisions/0002-knowledge-base-structure.md) — layout of AGENTS.md and docs/, conventions.
- [0003 Own data model; UDDF as baseline scope and import/export format](decisions/0003-own-data-model-uddf-as-adapter.md) — UDDF is checklist and adapter, not storage.
- [0004 API-first system architecture, deployed with Docker Compose](decisions/0004-system-architecture.md) — app image (API + web + worker) and PostgreSQL; built-in auth.
- [0005 TypeScript end-to-end; React web client](decisions/0005-typescript-stack.md) — Node LTS, React SPA, generated OpenAPI client; library candidates listed.
- [0006 Apache-2.0 license; MIT FIT parser in the image](decisions/0006-license-apache-2-and-fit-parser.md) — Garmin FIT SDK only as test cross-check (its license forbids redistribution).
- [0007 Fastify as HTTP framework](decisions/0007-fastify-http-framework.md) — routes, OpenAPI via @fastify/swagger, official plugins; thin handlers.
- [0008 Drizzle for database access and migrations](decisions/0008-drizzle-database-access.md) — schema in TypeScript, generated + reviewed migrations, raw SQL where clearer.
- [0009 TypeBox for API schemas](decisions/0009-typebox-schemas.md) — Fastify-native JSON Schema; OpenAPI without conversion.
- [0010 Graphile Worker as job queue](decisions/0010-graphile-worker-job-queue.md) — enqueue via SQL in the Import transaction; LISTEN/NOTIFY.
- [0011 Better Auth for accounts and sessions](decisions/0011-better-auth.md) — ≥ 1.7.7, argon2id, invite-only, database sessions, small plugin set.
- [0012 Invitation links, setup token for the first admin, 2FA later](decisions/0012-invitations-and-admin-bootstrap.md) — copy-link invitations, setup token in the log, no impersonation.
- [0013 Account management](decisions/0013-account-management.md) — reset links, disable vs delete, always one admin, only four Better Auth endpoints over HTTP.
- [0014 Design system, localization, error codes, units](decisions/0014-design-system-and-localization.md) — React Aria + own tokens, i18next (en, de), API error codes, metric/imperial per User.
- [0015 Overrides, optimistic locking, device vocabulary, browser tests](decisions/0015-overrides-vocabulary-and-browser-tests.md) — overridden fields marked on the Dive, version checks, our words for device values, Playwright.
- [0016 Deciding about Recordings, Devices, extra Divers](decisions/0016-recording-decisions-and-divers.md) — resolve Duplicate candidates on the logbook, split off, Device reassignment for the future, move Dives, Divers page.
- [0017 Logbook list with offset paging, sorting and search](decisions/0017-logbook-list-paging.md) — `GET /api/dives` returns `{ dives, total }`; limit/offset, sort by column, search number and notes; settings in the address.
- [0018 Lucide icons beside text; motion only where it explains](decisions/0018-icons-and-motion.md) — `ui/Icon.tsx` map, no icon-only buttons; menus, dialogs, notices animate in; nothing with reduced motion.
- [0019 Tonal surfaces, comfortable density, no component library](decisions/0019-tonal-surfaces.md) — panels lift off the page by tone (no outline), attention is a tint; React Aria stays, no Tailwind. Amends 0014.
- [0020 Dive sites shared by all Users, positions without PostGIS, no map yet](decisions/0020-dive-sites.md) — any User edits (versions, Revisions), creator/admin deletes unused; entry/exit positions on Recordings; auto-link to the only site within 200 m; "open in maps" link.
- [0021 External site IDs and an admin import of Dive sites from OpenStreetMap and Wikidata](decisions/0021-site-external-ids-and-import.md) — external IDs per Source (osm, wikidata, ssi) show where a site comes from; admin-only worker import by country/box/everywhere, ODbL explained and confirmed; per-field 3-way re-import; link, then 100 m + name matching; SSI ID by hand; maximum depth.
- [0022 Merging duplicate Dive sites; paging the site list; a client contract](decisions/0022-merging-sites-and-site-list-paging.md) — any User merges (kept site wins, gaps filled, no undo); Dives and External IDs move, imports follow; nearby sites on the site page; site list pages, sorts, filters; docs/spec/clients.md.
- [0023 Checks by what changed, and a faster full check](decisions/0023-faster-checks.md) — `pnpm check` by changed area (tags), `pnpm check:full` before a commit; browser tests on 2 workers with a server each, no traces, axe in 2 of 4 variants; review capture by area. 10½ → 3 min.
- [0024 SSI as the first Target, through its private app API](decisions/0024-ssi-target-via-app-api.md) — create/update/delete with profile, SSI dive ID on the Push; User chooses encrypted password or expiring token at connect; honest User-Agent; Diver External IDs, Connection Diver mappings; admin SSI site import at the operator's risk; API slice first, QR later.
- [0025 SSI site import, offers on hand-made sites, and the water type on the Dive site](decisions/0025-ssi-site-import-and-site-water-type.md) — SSI imported like OSM after a confirmed explanation (no comments, private sites, aliases); per-field precedence (SSI names, OSM positions); hand-made sites get an offer any User takes; "only fill" runs; water type moves from the Dive to its site, with a hint when the computer was set to other water. Amends 0015, 0021, 0024.
- [Template](decisions/template.md) — copy for new ADRs.

## References
- [references/README.md](references/README.md) — how to record external projects/sources.
- [UDDF](references/uddf.md) — Universal Dive Data Format: baseline scope, import/export format.
- [Garmin FIT](references/garmin-fit.md) — binary activity format with dive messages; primary inbound format.
- [libdivecomputer](references/libdivecomputer.md) — dive computer download/parse library; minimum sample model.
- [Subsurface](references/subsurface.md) — leading open-source dive log; import source, model ideas.
- [divetracx](references/divetracx.md) — self-hosted dive log; closest prior art.
- [DiveJSON](references/divejson.md) — new draft JSON dive log schema; format-quirk mappings.
- [SSI app API](references/ssi-app-api.md) — SSI's private MySSI API as Dive Hub uses it: sign-in, logbook, create/update/delete, the dive record and samples, the site list's fields (checked 2026-10-05), quirks, what to do when it changes, the owner's pending checks.

## Research
- [2026-10-02 Knowledge base practices](research/2026-10-02-knowledge-base-practices.md) — AGENTS.md, LLM wiki, ADRs, spec-driven dev, Diátaxis.
- [2026-10-02 UDDF gap analysis](research/2026-10-02-uddf-gap-analysis.md) — what UDDF covers and lacks for a multi-user, multi-source hub.
- [2026-10-02 Dive data sources and targets](research/2026-10-02-dive-data-sources.md) — access paths for Garmin, Suunto, SSI, PADI; formats to support.
- [2026-10-02 Self-hosted architecture](research/2026-10-02-self-hosted-architecture.md) — how 16 comparable apps package API, web, worker, queue, DB, auth; verdict on ADR 0004.
- [2026-10-02 FIT parsing libraries](research/2026-10-02-fit-parsing-libraries.md) — official SDKs vs community parsers, FIT license, dive pitfalls, language ranking.
- [2026-10-02 Server and web stack](research/2026-10-02-server-and-web-stack.md) — language/framework comparison; top: TypeScript end-to-end, .NET + TS SPA, Go + TS SPA.
- [2026-10-02 Garmin Descent sample probe](research/2026-10-02-garmin-descent-sample-probe.md) — real Mk3 file: USB = Export Original, contents, fit-file-parser must read `messages`.
- [2026-10-02 Agent skills vetting](research/2026-10-02-agent-skills-vetting.md) — candidate skills for the stack read and rated: install now / with library choice / reject.
- [2026-10-02 Better Auth fit check](research/2026-10-02-better-auth-check.md) — Better Auth docs checked against our auth requirements.
- [2026-10-02 Data, sync, upload, auth](research/2026-10-02-data-sync-upload-auth.md) — sample storage, Originals and zip uploads, Revisions and sync API, sessions and OIDC-readiness.
- [2026-10-03 UI/UX review](research/2026-10-03-ui-review.md) — ranked findings (tiers A–D) with fixes, all fixed in four batches with tests; next: icons and motion.
- [2026-10-03 Visual refresh](research/2026-10-03-visual-refresh.md) — brief and handover for the "clean and modern" pass; done 2026-10-04 (direction B, ADR 0019).
- [2026-10-04 UI component libraries](research/2026-10-04-ui-component-libraries.md) — shadcn/ui (now with a React Aria base), Kibo, React Aria kits, headless and styled libraries, single parts; licenses checked; decided: keep our React Aria components (ADR 0019).
- [2026-10-04 Visual refresh proposal](research/2026-10-04-visual-refresh-proposal.md) — ten ranked changes from the screenshots and directions A/B/C (surfaces, radius, density) with a [mock](research/assets/2026-10-04-visual-refresh-mock.html); owner chose all ten changes and B, implemented.
- [2026-10-04 Responsiveness](research/2026-10-04-responsiveness.md) — 320–1440 px and 200 % text measured and locked in with tests; tables switch by container width; mobile skills checked (`mobile-native` proposed).
- [2026-10-04 Dive site sources](research/2026-10-04-dive-site-sources.md) — open data to preseed Dive sites (OSM 1,401 dive spots ODbL, Wikidata 345 CC0; others rejected) and external site IDs (SSI IDs not public); recommends an admin import, no bundled data; follow-up: no cross-links between the two sets, depth tags.
- [2026-10-04 SSI app API](research/2026-10-04-ssi-api.md) — community projects that reverse-engineered MySSI's private API (divesend, divebridge, divessi-log-importer, …): password → token, create/update/delete with profile and SSI dive ID back, dives stay unconfirmed, site list without licence, no terms or partner programme; API by default, QR as fallback; decided in ADR 0024.
