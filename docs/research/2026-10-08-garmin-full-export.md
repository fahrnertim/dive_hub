---
title: Garmin full account export
summary: What the owner's Garmin account export contains (6,201 FIT files, 24 of them dives, plus Garmin's own dive JSON), what today's import does with it (reads every dive, but keeps 6,172 non-dive files as Originals and takes 87 s), a dry run against the logbook, and a proposal for what "importable" should mean.
status: done
date: 2026-10-08
---

# Garmin full account export

## Question

The owner requested the full data export of their Garmin account ("Export Your Data"). What is in it, how do its dive
files differ from the single FIT files the import reads today, and what has to change so that uploading it puts its dives
into the logbook without doubling the ones already there?

## Method

- One real export, kept in git-ignored `samples/private/` ([samples](../../samples/README.md)). Unpacked outside the
  repository; probe scripts lived outside it too.
- Every file was run through the import's own code (`extractFiles`, the format registry, the FIT adapter) and, for
  comparison, through `@garmin/fitsdk` 21.217.0 with unknown data included.
- **Today's import, unchanged, was run over the whole export** in a throwaway test database, twice.
- **A dry run against the owner's development logbook**, in a read-only transaction: for each dive file, what the import
  would decide (same file, same Recording key, the import's `decideMatch` against the Dives of the Diver who owns the watch).
- Positions, serial numbers, the account's identifiers, names and exact dates are left out of this note.

## Findings

### What the archive contains

One zip of 25.3 MB (33.6 MB unpacked), 145 entries, 37 of them empty folders for Garmin products the account doesn't use.

| Folder | Contents | For Dive Hub |
|---|---|---|
| `DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip` | **A nested zip with 6,201 FIT files** (52.4 MB unpacked, 25.1 MB packed): everything the watches ever synced. Flat, named `<account e-mail>_<upload id>.fit`. | The dives are here |
| `DI_CONNECT/DI-DIVE/` | Garmin's own dive log as JSON: 24 `Dive-ACTIVITY<id>.json`, 5 `Dive-GEAR<id>.json` | See "Garmin's dive JSON" |
| `DI_CONNECT/DI-Connect-Fitness/` | `…_summarizedActivities.json` (243 activities of every sport, one summary each), workouts, personal records, gear, a nested zip with one FIT backup | Not needed |
| `DI_CONNECT/DI-Connect-Wellness/`, `-Metrics/`, `-Aggregator/`, `-User/`, `-Device/`, `-Social/` | Sleep, health status, heart-rate zones, training load and readiness, hydration, daily summaries, profile and profile pictures, a device backup (nested zip), a second nested zip with one FIT backup | Not dive data; health data |
| `customer_data/`, `IT_*`, `DI_MEDIA_GDPR_SERVICE/`, `DI_LIVETRACK/`, `DI_CONNECT_IQ/`, `DI-GOLF/` | Customer record, orders, consent history, event log, media list, settings | Not dive data |

- **Four nested zips**, one level deep. The outer file name ends in `_1` and the inner ones in `_Part1`: Garmin splits
  larger accounts into several parts. Each part can be uploaded by itself, since every dive is one file.
- The archive covers about 13 months of one Descent Mk3 (three stray files come from an earlier watch).

### The 6,201 FIT files

All are well-formed: the SDK's integrity check passes on every one, with no decoding errors. 6,196 are distinct by hash
(five small settings files repeat).

| `file_id.type` | Files | Size | What it is |
|---|---|---|---|
| `activity` (4) | 243 | 21.8 MB | One recorded activity each: **24 dives**, 219 others |
| `monitoringB` (32) | 2,125 | 25.7 MB | All-day monitoring (steps, heart rate, stress) |
| 44 | 2,580 | 2.7 MB | Undocumented, small, device metrics |
| 49, 68, 79 | 370, 390, 359 | 0.9 MB | Sleep, HRV status, sleep disruption |
| 41, `segmentList`, 72, 74 | 132, 2, 1, 1 | 0.1 MB | Sport settings and backups |

The 243 activities by sport: 131 HIIT, 20 generic, **17 single-gas diving, 5 multi-gas diving, 2 apnea diving**,
14 cycling, 10 tennis, 9 ice hockey, 9 running, 8 training, 5 walking, 4 swimming, 3 hiking, 2 soccer, 2 skiing. The
count and the sports agree with `summarizedActivities.json` (243) and with `DI-DIVE` (24).

The dive files are **2.0 MB of the 52.4 MB**: 96 % of the upload is not about diving, and most of that is health data.

### The dive files compared with a single FIT file

- **The same files.** The single dive probed on 2026-10-02 ([sample probe](2026-10-02-garmin-descent-sample-probe.md)) is
  in the export byte for byte (same SHA-256), as is one more dive already in the logbook. A dive imported earlier from the
  watch or from "Export Original" is recognised by its hash.
- **Same structure in all 24:** the messages the probe listed, the same undocumented ones (22, 79, 140, 141, 147, 233, 288,
  325 to 327, 394, 499) and the same unknown record fields (107, 135, 136, 143). No developer fields, no tank transmitter
  data, firmware 22.07 to 27.19.
- **The adapter read all 24 without an error** and gave every other file as "not a dive" (6,179: the 6,177 other files in
  the nested zip and the two FIT backups).
- **New compared with the one file known so far:**
  - **Start positions exist.** 9 of 24 files have a start position, 9 an end position, 5 both, 11 none. The probe's file had
    only an end position.
  - **Heart rate is not always there** (10 of 24), and NDL is absent on the shortest dives.
  - **Two UTC offsets** (two time zones), each read from `activity.local_timestamp`.
  - **Multi-gas mode without a second gas.** Five files have the sub-sport `multiGasDiving`, each with one enabled gas
    (air). They read like single-gas dives. A dive with a gas switch is still missing from the samples.
  - **Apnea sessions.** Two files (`apneaDiving`): one session with 7 and one with 3 dives, a lap and a `dive_summary`
    per dive, no gas, no deco data. Today's adapter makes one Recording of the session (mode `apnea`, duration of the whole
    session, the deepest depth).
  - **Short recordings.** 7 of the 24 last under 10 minutes; 3 are probable non-dives by the logbook check's rule
    (under 2 minutes and under 3 m, [ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md)).
  - **Recordings of one watch that follow each other closely:** five pairs with 2 to 16 minutes between the end of one
    and the start of the next (a false start before the dive, a short surfacing during training).
  - **Dive numbers have gaps:** the scuba files carry the watch's numbers 1 to 27, five are missing. Dives deleted in
    Garmin Connect are not in the export.

### Garmin's dive JSON (`DI-DIVE`)

One file per dive, all 24 matching a FIT file by start time, with equal depths and durations. It holds the summary only
(no profile). What it has that the FIT file lacks is what the user typed in Garmin Connect:

| Field | In how many of 24 |
|---|---|
| A dive number (two differ from the watch's number in the FIT file) | 22 |
| A name (8 distinct, mostly Garmin's default) | 24 |
| A location name, with entry and exit position (the same positions as in the FIT file) | 9 |
| A buddy (free text) | 5 |
| Notes | 1 |
| Tags | 1 |
| Gear linked to the dive (the 5 `Dive-GEAR` files: fins, BCD, suit, gloves, computer, with weight and buoyancy) | 24 |
| Per-dive details of an apnea session (each dive with times, depths, rates, splits) | 2 |

The FIT file's name carries an upload id, not the activity id, so a JSON file and its FIT file are tied by start time only.

### What today's import does with the export

The pipeline was built with this case in mind (`archive.ts` descends into nested zips, formats are detected by content),
and it works. Run unchanged in an empty database:

| | First run | Second run (same file) |
|---|---|---|
| Time | 87 s | 62 s |
| Outcome | 22 Dives created, 1 Recording attached, 1 Duplicate candidate, 6,179 "not a dive" | 24 unchanged, 6,179 "not a dive" |
| Originals kept | **6,196** (52.4 MB), 6,172 of them with no Recording | the same |

What is wrong with that:

1. **Every non-dive file is kept as an Original.** `processFile` stores the file and its row before it knows whether it is
   a dive. After one upload the server holds a year of sleep, heart-rate and stress data that Dive Hub has no use for,
   and that nobody asked it to keep.
2. **The outcome lists 6,203 lines** (790,000 characters of JSON on the Import), and the web client renders one element
   per line for a file import.
3. **Most of the time goes into the files that are thrown away**, and again on every repeat: a non-dive Original has no
   Recording to be recognised by, so it is parsed again. Parsing all 6,203 files takes 5 s; the rest is 6,203
   transactions and blob writes.
4. **Memory:** the upload is read into memory whole to look at its first bytes, and every accepted file is held in
   memory until the Import ends (here 52 MB, 320 MB process size). The unpacked-size limit is 8 GB, so a large archive
   could exhaust memory before any limit stops it.
5. **The entry limit is 50,000.** This account makes about 5,800 files a year, so an export of a watch worn for nine years
   would fail as a whole.
6. **Two Recordings of the same watch were attached to one Dive** in the empty database: 7 minutes at 5.8 m, three
   minutes at the surface, then 4 minutes at 6.2 m. The 5-minute tolerance exists for clock drift between two
   computers on one dive; one Device cannot record the same dive twice. Which of the five close pairs attach depends on the
   order of the files in the zip.

What already holds for an uploaded archive, which is untrusted input (read from `archive.ts`): names inside the
zip are never used as paths (nested zips get random temporary names, the base name is kept only for display), entry sizes
are validated while reading, and there are limits on the number of entries, the unpacked size, the nesting depth and the
compression ratio. The upload limit is 512 MB by default (`DIVEHUB_MAX_UPLOAD_MB`); this export is 25 MB.

### Dry run against the owner's logbook

Read-only, for the Diver the watch belongs to (88 live Dives). Each file was judged against the logbook as it is, not
against the Dives the same Import would create before it.

| What the import would do | Files |
|---|---|
| Unchanged: the same file is already there | 2 |
| Attached to a Dive without a Recording (a logbook entry from SSI) | 12 |
| Duplicate candidate, for the User to decide (a false start beside an entry; depths that disagree) | 2 |
| New Dive | 8 |

The 8 new ones are the two apnea sessions, four short recordings, and two dives of 2025 that have no entry within reach
(if their entries were typed with another time, the logbook check `entry_apart_from_recording` offers the pair).
So the existing matching already recognises what is in the logbook; nothing would be doubled silently.

## Proposal: what "importable" should mean

*Decided and built the same day: [ADR 0044](../decisions/0044-account-export-import-and-kinds.md). Two things differ
from this proposal: the User chooses the kinds of dive when an upload mixes them, and a file that fails to read is not
kept. With the new import the export takes 18 seconds, and only the dive files are kept.*

1. **Which files:** every FIT file in the archive that is a dive, found by content wherever it lies and however deep
   (as today). Garmin's JSON is not read.
2. **Non-dive files are not kept:** no Original, no blob, no line each. The Import says how many files it looked at and
   left out, as one count. The same rule for a single non-dive file uploaded by itself. A file that looks like a dive
   file but fails to read is still kept, so it can be read again later.
3. **Dives already in the logbook:** as today (same file: unchanged; same Recording key: updated; an entry in reach:
   attached; unclear: "Needs your decision"; deleted earlier: stays deleted). One change: **a Recording never attaches
   by itself to a Dive that already has a Recording from the same Device**, unless the two really overlap in time.
   It becomes a Dive of its own, and the logbook checks cover the rest.
4. **Apnea sessions:** imported as today, one Dive per session with mode apnea. Short recordings: imported, and the
   existing check "probably not a dive" offers the delete.
5. **Size:** the upload limit stays at 512 MB. Entries are handled one at a time instead of all in memory, the upload is
   no longer read into memory whole, and the entry limit rises to 500,000 (files are small and no longer kept). An
   export in several parts is uploaded part by part.
6. **Not in this slice:** reading `DI-DIVE` (dive numbers changed in Garmin Connect, buddy, notes, location name,
   gear, the single dives of an apnea session); removing non-dive Originals that earlier imports stored.

## Open points
- A dive with a gas switch and a dive with a tank transmitter: still no sample.
- Whether an export of a larger account looks the same (several parts, `UploadedFiles_0-_Part2.zip`): one account seen.
- What the undocumented file types 44, 49, 68, 72, 74 and 79 are exactly; not needed.

## Sources
- Local probe of the owner's export, a throwaway test database and a read-only dry run on the development database
  (nothing committed).
- [`@garmin/fitsdk` 21.217.0](https://www.npmjs.com/package/@garmin/fitsdk) for file types and message names.
