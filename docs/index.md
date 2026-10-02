---
title: Documentation index
summary: Map of all project knowledge. One line per document.
status: living
date: 2026-10-02
---

# Documentation index

Keep this list complete: add a line when a doc is created, remove it when deleted.

## Spec
- [spec/README.md](spec/README.md) — Product specification: vision, sources → hub → targets, open questions.
- [spec/data-model.md](spec/data-model.md) — Entities, ownership, relationships; UDDF checklist, gap coverage, scenarios.
- [spec/architecture.md](spec/architecture.md) — Components, import flow, Docker Compose deployment, auth.

## Glossary
- [glossary.md](glossary.md) — Domain language: User, Diver, Dive, Recording, Import, Push, …

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
- [Template](decisions/template.md) — copy for new ADRs.

## References
- [references/README.md](references/README.md) — how to record external projects/sources.
- [UDDF](references/uddf.md) — Universal Dive Data Format: baseline scope, import/export format.
- [Garmin FIT](references/garmin-fit.md) — binary activity format with dive messages; primary inbound format.
- [libdivecomputer](references/libdivecomputer.md) — dive computer download/parse library; minimum sample model.
- [Subsurface](references/subsurface.md) — leading open-source dive log; import source, model ideas.
- [divetracx](references/divetracx.md) — self-hosted dive log; closest prior art.
- [DiveJSON](references/divejson.md) — new draft JSON dive log schema; format-quirk mappings.

## Research
- [2026-10-02 Knowledge base practices](research/2026-10-02-knowledge-base-practices.md) — AGENTS.md, LLM wiki, ADRs, spec-driven dev, Diátaxis.
- [2026-10-02 UDDF gap analysis](research/2026-10-02-uddf-gap-analysis.md) — what UDDF covers and lacks for a multi-user, multi-source hub.
- [2026-10-02 Dive data sources and targets](research/2026-10-02-dive-data-sources.md) — access paths for Garmin, Suunto, SSI, PADI; formats to support.
- [2026-10-02 Self-hosted architecture](research/2026-10-02-self-hosted-architecture.md) — how 16 comparable apps package API, web, worker, queue, DB, auth; verdict on ADR 0004.
- [2026-10-02 FIT parsing libraries](research/2026-10-02-fit-parsing-libraries.md) — official SDKs vs community parsers, FIT license, dive pitfalls, language ranking.
- [2026-10-02 Server and web stack](research/2026-10-02-server-and-web-stack.md) — language/framework comparison; top: TypeScript end-to-end, .NET + TS SPA, Go + TS SPA.
- [2026-10-02 Garmin Descent sample probe](research/2026-10-02-garmin-descent-sample-probe.md) — real Mk3 file: USB = Export Original, contents, fit-file-parser must read `messages`.
- [2026-10-02 Agent skills vetting](research/2026-10-02-agent-skills-vetting.md) — candidate skills for the stack read and rated: install now / with library choice / reject.
- [2026-10-02 Data, sync, upload, auth](research/2026-10-02-data-sync-upload-auth.md) — sample storage, Originals and zip uploads, Revisions and sync API, sessions and OIDC-readiness.
