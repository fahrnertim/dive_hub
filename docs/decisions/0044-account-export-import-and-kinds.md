---
title: "ADR 0044: Importing an account export, and choosing the kinds of dive"
summary: An upload is read twice - first analysed (which files are dives, of which kind, how many), then imported; only files a dive was read from are kept; an upload with scuba dives and apnea sessions waits for the User's choice of kinds, with the counts, and is removed after 7 days without an answer; a Recording never attaches by itself to a Dive that has a Recording from the same Device unless the two really overlap; an archive is read one file at a time, up to 500,000 files. Amends 0016, 0037 and 0038.
status: accepted
date: 2026-10-08
---

# ADR 0044: Importing an account export, and choosing the kinds of dive

## Status
Accepted – 2026-10-08 (decided with the owner), and built. Amends the import's matching
([ADR 0016](0016-recording-decisions-and-divers.md), [ADR 0038](0038-logbook-checks-and-merging-dives.md)) and what an
Import keeps ([ADR 0037](0037-suunto-file-import-and-file-formats.md)).

## Context
Garmin's account export is one zip with everything the account holds. The owner's has 6,201 FIT files in a nested zip;
24 of them are dives (22 with a gas, 2 apnea sessions), the rest monitoring, sleep and other sports
([research note](../research/2026-10-08-garmin-full-export.md)). The import read all 24 dives, but:

- every file became an Original (6,196 kept files that are no dives), and the Import's outcome had 6,203 lines;
- it took 87 seconds and held the whole unpacked archive in memory;
- the archive limit of 50,000 files is close for a larger account;
- two dives a few minutes apart from the same computer were attached to one Dive, as if they were two computers' Recordings of it;
- apnea sessions came in with the scuba dives, wanted or not.

## Decision
1. **Analysed first, imported second.** An upload is read twice. The first pass parses every file and writes nothing: it
   counts what the upload holds (`found`: `scuba`, `apnea`, `otherFiles`). The second pass reads only the files to
   import and places their Recordings.
2. **Only dives are kept.** A file becomes an Original only once a dive of a chosen kind was read from it. Files that
   are no dive are neither stored nor listed: they are one number (`found.otherFiles`). A single uploaded file that is
   no dive is still named (`not_a_dive`), an archive without any dive says so once (`no_dive_file`). A file that looks
   like a dive file and fails to read is reported (`file_failed`) and not kept either; the research note proposed
   keeping it, which was dropped: a file nobody can read is of no use here, and the User still has it.
3. **Kinds of dive, chosen by the User when an upload mixes them.** Two kinds: `scuba` (every dive with a gas: open
   circuit, rebreather, gauge) and `apnea`. An upload with one kind imports straight away, as before. An upload with
   both stops after the analysis (`awaiting_choice`) and shows how many of each it holds; the User starts it with the
   kinds to import (`POST /api/imports/{id}/start`) or cancels it (`POST /api/imports/{id}/cancel`). Both are offered
   checked. What was left out is said with the outcome.
4. **A waiting upload does not stay for good.** Nothing is written while an Import waits; only the upload lies in
   `incoming/`. Cancelling removes it. After 7 days without an answer the Import is ended (`cancelled`, error code
   `choice_expired`) and the upload removed, by an hourly worker task.
5. **Same Device, no attaching within the tolerance.** A Recording attaches by itself to a Dive that already has a
   Recording from the same Device only when the two really overlap (tolerance 0); within the 5 minutes of tolerance
   alone it becomes its own Dive. One computer cannot record the same dive twice, so two files minutes apart are two
   dives (a second attempt, a training session). Recordings from different Devices keep the tolerance. The logbook check
   `overlapping_dives` already asks for a real overlap, so check and import agree.
6. **Limits.** The upload limit stays at 512 MB. An archive is read one file at a time (a nested zip goes to a temporary
   file, removed afterwards), never as a whole in memory; up to 500,000 files, the other limits unchanged (unpacked
   bytes, nesting, compression ratio, 64 MB per file).
7. **Not read:** Garmin's own dive list in the export (`DI_CONNECT/DI-DIVE/*.json`). It names sites and gear the FIT
   files lack, and is a later slice with its own decisions (it would be a second source for the same dives).
8. **No clean-up** of Originals kept by earlier imports of such an export: no instance has any.

## Considered options
- *Ask before every archive.* Rejected: most uploads hold one kind, and a question with one answer is noise.
- *A setting "which kinds I log".* Rejected for now: the answer is only useful with the counts, which the User sees
  after the analysis; a default per User can follow if the question becomes a habit.
- *Keep every file as an Original* (as before). Rejected: thousands of health files are personal data without a purpose here.
- *More kinds* (gauge, rebreather, snorkelling). Not now: the owner's data has two, and each kind is a line in the question.

## Consequences
- The owner's export: 18 seconds instead of 87, 22 or 24 Originals instead of 6,196, an outcome of 22 or 24 lines; a
  second upload of the same export finds every dive unchanged.
- An Import has two new statuses (`awaiting_choice`, `cancelled`), `found` and `kinds`; clients show the counts, ask,
  and say what was left out ([client contract](../spec/clients.md#imports)).
- An upload is parsed twice; for a single dive file that is a few milliseconds.
- A kind left out is not remembered: uploading the export again asks again, and choosing the other kind then imports
  it (the dives already here are unchanged).
- An outcome longer than five lines is shown counted by result in the web client, not line by line.
- The web client announces the end of an upload it made itself even when it never saw it running.

## Open
- **Where the waiting upload shows** (owner, 2026-10-08): it sits in the "Imports" panel below the dive list on the
  logbook, where running imports show, so with a long logbook the question is out of sight until the User scrolls. It
  may move (above the list, or as a line like "needs your decision"); left as it is for now.

## As built
- Server: `imports/archive.ts` (`eachFile`), `imports/import-service.ts` (`processImport`, `startImport`,
  `cancelImport`, `expireWaiting`, `kindOf`), `imports/matching.ts` and `placement.ts` (`sameDevice`), worker task
  `expire_waiting_imports` (hourly), migration `0026_import_kinds`.
- Web: `ImportPanel.tsx` (`ImportChoice`, `LeftOut`); a waiting Import shows on the logbook until it is answered.
- Tests: `archive.test.ts`, `account-export-import.test.ts`, `matching.test.ts`; browser tests in
  `e2e/ui-quality.spec.ts` with the hand-made `e2e/fixtures/account-export.zip`
  (`apps/server/test/fixtures/write-account-export-fixture.ts`).
