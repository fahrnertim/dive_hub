---
title: Documentation index
summary: Folder-level map of the project's durable knowledge.
status: living
date: 2026-11-04
---

# Documentation index

Durable product knowledge lives here; work state (tasks, plans, discussion) lives in Paperclip
([ADR 0065](decisions/0065-work-runs-through-paperclip.md)). Search a folder instead of reading it through.

- [spec/](spec/README.md): the product specification. Vision, data model, architecture with implementation status,
  the client contract every API client follows, and the design system.
- [glossary.md](glossary.md): domain language with the German UI words. Tests and interfaces use its terms.
- [decisions/](decisions/template.md): ADRs, numbered `NNNN-title.md`, copied from `template.md`. Only decisions that
  are hard to reverse, surprising and a real trade-off.
- [references/](references/README.md): one file per external project, format or API the product depends on
  (UDDF, Garmin FIT, the SSI app API, libdivecomputer and others).
- [research/](research/): dated notes (`YYYY-MM-DD-topic.md`) that an ADR or the spec cites, sources linked.
- [development.md](development.md): setup, layout, common tasks and the checks (`pnpm check`).
- [skills.md](skills.md): the installed agent skills and the project rules that win over them.
- [agents/check-escapes.md](agents/check-escapes.md): failures CI's full check found after a green local check.
- [../samples/README.md](../samples/README.md): where real dive files go and how fixtures are derived.
