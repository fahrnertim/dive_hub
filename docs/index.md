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

## Glossary
- [glossary.md](glossary.md) — Domain language: User, Diver, Dive, Recording, Import, Push, …

## Decisions (ADRs)
- [0001 All project knowledge lives in this repository](decisions/0001-all-project-knowledge-in-repo.md) — no local/account memory; enforcement layers.
- [0002 Knowledge base structure](decisions/0002-knowledge-base-structure.md) — layout of AGENTS.md and docs/, conventions.
- [0003 Own data model; UDDF as baseline scope and import/export format](decisions/0003-own-data-model-uddf-as-adapter.md) — UDDF is checklist and adapter, not storage.
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
