---
title: Continuation - appending a Dive cut in two by a surface break to the Dive before it
summary: Consecutive Dives of one Diver from the same dive computer, cut apart because the computer ended the dive at the surface, become one Dive - a joined Recording made from them (each gap as 0 m, marked as a Surface break) is its Primary recording, the Recordings stay as its parts, the later Dives are deleted like merged ones and their Provider links stay on them so no import brings them back; found by a new logbook check (same Device, at most 10 minutes apart; chains as one item) and offered by hand; undone as a whole append by restoring. ADR 0063.
status: accepted
date: 2026-10-31
---

# Continuation

Design from the owner's answers on 2026-10-31 and 2026-11-01; approved by the owner on 2026-11-01. "Owner" marks what the owner decided; "my call" marks what the designer
decided and the owner may overturn. The decision that changes accepted ADRs is
[ADR 0063](../../decisions/0063-dive-continuation.md).

## Intent

The owner's dive on 2026-10-26 (logbook numbers 85 and 86, read-only from the development database): during the dive
they brought a ghost net from shallow water up to the boat, then went back down. Their Garmin ended the dive at the
surface, so there are two Recordings and two Dives, each fetched from Garmin and linked to its own Garmin activity:

| | Start (local) | Duration | Max depth | Samples |
|---|---|---|---|---|
| 85 | 08:05:49 | 19:40 | 7.1 m | surfaces at 18:40, then ~1 min at 0.0–0.3 m until the computer ends the dive |
| gap | | 4:01 | | nothing recorded |
| 86 | 08:29:30 | 25:30 | 7.9 m | first sample at 1.9 m (the computer starts recording on the way down) |

They want one Dive whose profile shows the time at the surface as 0 m. This is not a merge (ADR 0038 folds two Dives of
the *same* descent into one); here two *consecutive* parts of one dive become one.

## Words (owner)

- **Continuation** (_Fortsetzung_): a Dive that is the rest of the Dive before it, cut off by a surface break. **Appending**
  (_anhängen_) it makes the two one Dive. Avoid: merge (the same descent twice), combine, join, stitch, attach (that is
  a Recording's; German "hinzufügen"), split dive.
- **Surface break** (_Oberflächenaufenthalt_): the time at the surface inside one Dive between two Recordings of it.
  Not the surface interval between two dives (German _Oberflächenpause_).
- On screen: the suggestion card's button is just **Anhängen**; the card around it says what happens (owner). The dive
  page's menu item is **"An den vorherigen Tauchgang anhängen…"** (it has no card around it).

## Goals

- One Dive from two that a surface break cut apart, its profile continuous with the break at 0 m (owner).
- Dive Hub finds such pairs and suggests them in "Needs your decision"; nothing is appended unasked (owner).
- Appending by hand from the dive page, for pairs the rule doesn't find (my call, as merge does).
- No import (a file upload, a Garmin or SSI fetch) brings the later Dive back or undoes the continuation.
- Undone by restoring from "Deleted dives", and an undo reverses the whole append: every Dive it took comes back
  (owner, 2026-11-01).
- More than two parts: a dive cut twice (three parts) is appended in one go, and a joined Dive can take a further Continuation
  later (owner, 2026-11-01).

## Non-goals

- A "time underwater" metric for every Dive (owner: left out for now).
- A "split at the surface break" action (owner: restoring is enough).
- Different computers, different Divers (owner: same computer only). A Recording from another computer is the existing merge.
- Dives without a Recording (logbook entries): nothing to join; a merge or a corrected duration fits them.
- Joining the Recordings of a second computer that also split the dive: only Dives with exactly one live Recording
  each are appended (my call).

## Anti-goals

- One Dive holding two Recordings that have nothing to do with each other (owner's worry).
- The 0 m stretch looking like recorded data, or making up findings (a descent from 0 m to the first real sample).
- An import that answers "new dive" for the second half after it was appended.

## The design

### Data: a joined Recording (my call, owner agreed)

- **Appending builds one new Recording from the two**: the first part's samples, the surface break, then the second
  part's samples, on one time axis from the first part's start. It names its parts (two or more; each further part after a further break) and is the kept Dive's **Primary
  recording**. Everything that reads a Dive's profile (the profile chart, summary values, the dive assessment, sending to
  SSI, MCP, export) keeps reading one Recording and needs no notion of parts.
- **The parts' Recordings stay** on the kept Dive, each with its Original and its Recording key, shown as the joined
  Recording's **parts** (not as two more computers) and never offered as Primary. They are what imports find.
- **The joined Recording has no Original and no Recording key an import can match**: it is derived (my call for its
  columns): the parts' Device; `recording_key` `continuation:<its own id>` (unique, never produced by an import);
  `parser` `continuation` with its own version; `original_id` and `import_id` empty, allowed only for this kind (a check
  constraint). **Any number of parts**: each part points to its joined Recording and to the **append** that brought it
  in; parts are ordered by start (my call; the first part points to the first append). Migration: a protected path, so
  the owner sees its shape when it is written.
- **Its sample series are stored**, copied from the parts with the break filled in (my call): readers stay unchanged.
- **Rebuilt, never edited**: in the same transaction as any write of a part's samples or summary (an upload or fetch
  updating the part in place, a parser version reading Originals again), the joined Recording is rebuilt from its parts.
  The plan lists every writer of `sample_series` and `recording` summaries, with a test each.
- **Rejected:** keeping two Recordings and stitching them only when drawn: every reader (assessment, summary, export,
  SSI) would have to learn about parts, and "Primary recording" would stop meaning one Recording.

### The surface break in the samples

- Between the first part's last sample and the second part's first, the depth is **0 m** (owner), as real **0 m depth
  samples** at the first part's sample interval, from one interval after its last sample to one interval before the
  second part's first (my call). The assessment's `segments()` ([signals.ts:67](../../../apps/server/src/assessment/signals.ts#L67))
  splits only at a run of surface samples inside the series, so the break must be samples, not an empty stretch. Other
  channels (temperature, pressure, ppO2, NDL) have no samples there: a gap, not invented values (my call).
- The break is kept as an interval (start, end in seconds from the start) in the joined Recording's summary, and the API
  gives it as `surfaceBreaks` with the Recording (my call; a new response field, in the client contract with the build).
  The chart shows it as a shaded band labelled with its length ("Oberflächenaufenthalt 5 min").
- **No made-up rates.** The step from the break's last 0 m sample to the second part's first sample (1.9 m in the owner's
  dive) is not a measured descent, nor is the first part's last sample to the break an ascent: rate rules (ascent,
  descent, sawtooth) skip windows that touch a Surface break's edges (my call), and the chart doesn't colour that step
  as an ascent or descent. The test is the owner's dive.

### Summary values of the joined Recording (my call)

| Value | Rule |
|---|---|
| Start | the first part's start |
| Duration | the whole span, first descent to final surfacing, surface break included (owner) |
| Max depth | the deeper of the two |
| Average depth | over the time under water only, time-weighted; the surface break doesn't count |
| Surface break | its length, shown with the duration ("50 min · 5 min at the surface") |
| Water temperature | the lowest of the parts' minimums (as the Dive shows a minimum today) |
| Gas | per cylinder: start pressure from the first part, end pressure from the second; gas used from those |
| CNS, OTU | CNS at the end of the second part; OTU summed |
| SAC/RMV, the computer's own ascent rates and TTS | computed again from the joined samples where Dive Hub computes them; a device-only value that can't be combined is left out |
| Entry/exit position | entry from the first part, exit from the second |
| Dive mode, gas mixes, settings | from the first part; the parts share a Device, so they agree |

Values the Diver overrode by hand on the kept Dive stay Overrides.

### Which Dive stays, and what happens to the other (my call: the merge's rules)

- **The earlier Dive is kept** (its ID, Revisions, number). The later one is the continuation.
- **The kept Dive is filled from the later one** as in a merge: site, Participants and values where it has none; the later
  one's notes are appended, never dropped.
- **Provider links move as in a merge**: where the kept Dive has no remote dive at a Provider, the later one's link (its
  Pushes) moves to it; where both have one, the later one's stays on the deleted Dive.
- **The later Dive is deleted the normal way** (ADR 0026), its last Revision naming the Dive it continues
  (`continuedInto`, my name); the kept Dive gets a Revision `continuation`, after an entry for the Recording that came
  across. One transaction.
- **Dive numbers** follow [ADR 0048](../../decisions/0048-dive-numbers.md): one Dive less, the later numbers move down by
  one, as after a merge; a Provider that follows numbers gets them.

### Idempotence

| Arrives later | Found by | Outcome |
|---|---|---|
| The second half's file uploaded again | its Recording key, on a live part of the kept Dive | updated in place or `unchanged`; the joined Recording is rebuilt if its samples changed |
| The first half's file uploaded again | its key, the other part | the same |
| The Garmin fetch (both activities linked) | the second activity's link stays on the deleted Dive | skipped as `deleted_earlier` (verified: [dive-import.ts:259](../../../apps/server/src/providers/dive-import/dive-import.ts#L259)); the first activity is linked to the kept Dive, `unchanged` |
| A Garmin fetch when only the second half was linked | that link moved to the kept Dive | `unchanged`; the first half isn't downloaded either if it was linked, else it is found by key on the kept Dive |
| SSI, both halves sent | the second entry's link stays on the deleted Dive | skipped as "deleted earlier", as for a merge |
| A computer dive from SSI (`ssi:<id>` key) | its key, on a live part | updated in place, as today |

The outcome reason stays `deleted_earlier` (my call); a new reason would be a new client duty for little gain.

### Already sent to SSI: two dives there, one here (owner: yes, as a merge does)

- Where both Dives are at a Provider, the append dialog asks per Provider whether to delete the later one there too
  (`alsoAt`), exactly as the merge dialog; a Connection with "Delete at the Provider" on deletes it by itself after the
  quiet period (ADR 0056), and the dialog says so.
- The kept Dive is then outdated there; "Send update" sends the longer duration and the joined profile. The card warns
  that SSI then renumbers its later dives and that the update removes a dive centre's QR verification (ADR 0038, 0043).

### Undo: restoring reverses the whole append (owner, 2026-11-01)

- **An append is one operation** and may take several Dives at once (A with B and C). Restoring any Dive it took
  restores **every Dive of that append**; "Deleted dives" lists them as one entry ("2 dives appended to dive 85").
- **Later appends go too.** Appending B to A, then C to the joined Dive, are two appends. Undoing the second brings C
  back and leaves A + B joined. Undoing the first can't leave A + C joined across B's gap, so it undoes the later append
  as well: A, B and C are separate again. The restore dialog says so before ("This also takes dive C back out").
- Each restored Dive comes back **with its part Recording** (my call: unlike a merge, whose restore gives nothing back;
  a restored half without its Recording would be an empty entry). A part comes back as it is now (updated by imports
  since, if they did) and is its Dive's Primary recording. The joined Recording is rebuilt from the parts that remain,
  or deleted when one remains; that one becomes Primary again and values without Override follow it; Overrides (also
  those set by the append, as a merge sets them) stay.
- The joined Recording is found wherever it is now: if its Dive was merged into another since, the restore works on that
  one.
- Its Provider links come back with it where they stayed on it; a link that had moved to the kept Dive stays there,
  as after a merge. Values filled into the kept Dive and the appended notes stay (as a merge's).
- Restoring writes the answer "two dives" for each pair it separates (as restoring a probable non-dive records "keep
  it"), so the check doesn't suggest them again at once.
- If the kept Dive was deleted meanwhile, the restored Dive gets its Recording back and stands alone.

### The rule: `surface_break` logbook check (owner: automatic detection; numbers my call)

A pair is found when:
- same Diver;
- each Dive has exactly one live Recording, both from the **same Device** (owner);
- the later Recording starts **after** the earlier one ends and **at most 10 minutes** after it (my call; the owner's
  gap was 4 min 01 s; real repetitive dives usually have 30 minutes or more);
- neither Recording is a probable non-dive (`probablyNoDive`, ADR 0038): a false start 5 minutes before the real dive
  must be offered for deleting, not for appending (my call; the owner's logbook has exactly that case);
- a joined Dive may be the earlier one; the 10 minutes count from its last part's end (owner: more than two).

**Chains are one item** (my call): pairs that follow one another (A–B, B–C) are offered together, "Make these 3 dives
one", and **Anhängen** appends them in one append, which an undo reverses as a whole.

Where the start position is known for both and they lie far apart it would be a sign of two dives; not used now (my
call: the Device and the 10 minutes are strong enough, and a wrong suggestion costs one click).

- **Never obvious**: not part of "Merge the clear pairs"; each pair needs its own click.
- **Resolutions** on the card: **Anhängen** and "these are two dives" (kept per pair, Undo and "Ask again", as today).
- **One before, one after**: a Dive has at most one partner before it and one after it in this rule (the nearer wins, as
  in `entry_apart_from_recording`; a tie gives no suggestion).
- `LOGBOOK_CHECKS_VERSION` goes up by one.

### By hand

- The dive page's menu has "An den vorherigen Tauchgang anhängen…" when the Diver's Dive just before it (by start) has
  one Recording from the same Device, or is a joined Dive of that Device, and no Dive lies between them; the dialog says which stays, which goes to "Deleted
  dives", the surface break's length, and asks the Provider question. No 10-minute limit by hand (my call); the same
  Device is required (owner).
- The server's operation has the same preconditions apart from the 10 minutes, and refuses otherwise (a 400 code of its
  own).

### A joined Dive in the existing flows (my calls)

The joined Recording and its parts are one unit: they move together and are never separated except by restoring.
- **Another computer's file** overlapping a joined Dive is placed as today: attached (or a Duplicate candidate) as an
  ordinary Recording of another Device. The User may make it Primary; the joined Recording stays as a Recording.
- **Merging (ADR 0038)** with a joined Dive works either way: when the joined Dive is the one deleted, its joined
  Recording and parts attach to the kept Dive together; the Primary recording is chosen as for any merge.
- **Splitting off:** a part can't be split off or deleted on its own (refused with a code of its own); the joined
  Recording can be split off only with its parts, making a Dive of them. Undoing an append is restoring a Dive it took.
- **Moving to another Diver** takes the unit along, as any Recordings.
- **Listing a Dive's Recordings:** parts are listed under their joined Recording, not beside it; code that picks a
  Recording (Primary choice, earliest-remaining after a split, `hasRecordingOf` in the import) treats the unit as the
  joined Recording, with the parts' Device. The plan lists the places (`primaryRecordingId` uses in `dive-service.ts`
  and others).
- **The deleted Dive's reason** is a new value beside merge's (`deleteLeftBehind`, `merging-service.ts`), with a
  migration if it is an enum.

### Assessment (owner: every ascent is judged alike)

- No rule changes. The engine already splits a profile at ≥ 60 s at the surface and judges each part's ascent, last
  metres and safety stop ([profile-rules.ts](../../../apps/server/src/assessment/profile-rules.ts)); the joined Recording
  is judged as its parts. The owner's dive stays under 10 m, so no safety stop is asked for there.
- The only change is the anti-goal above: the edges of the surface break make no descent or ascent rate.
- Findings put aside on the later Dive are not carried over (as in a merge); the kept Dive's are computed again.

### Client duties (for [docs/spec/clients.md](../../spec/clients.md), written in the same change as the build)

- Show a `surface_break` check: its Dives (two or more), each break's length, the button **Anhängen** with text that says what
  happens (one Dive, the later one goes to "Deleted dives" and can be restored).
- Offer appending by hand on the dive page, with the dialog's "stays" / "goes" and the Provider question (as merge).
- Mark Surface breaks in the profile chart from the joined Recording's intervals; show the break with the duration.
- Show a joined Recording's parts under it (named by their Device and time), not as more computers; no "make primary"
  or "split off" for a part.
- A deleted Dive with `continuedInto`: say it was appended to that Dive and link it; list the Dives of one append as
  one entry; before restoring, say which Dives come back (also those of later appends); restoring brings their
  Recordings back.
- History: the `continuation` entries.

## Constraints

- ADR 0038 (merge's rules reused), 0026 (soft delete, `deleted_earlier`), 0016 (Recordings, Primary), 0030 and 0062
  (imports by key and by link; a fetch never replaces a Recording), 0048 (renumbering), 0036 (findings), 0053 (module
  boundaries: continuation lives beside merging in the generic layer and reads links as merging does, never a Provider by
  name), 0056 (deleting at a Provider after the quiet period).
- Tests against a real PostgreSQL; the owner's dive as a fixture built from two FIT files of one Device 4 minutes apart.
- `docs/decisions/**`, migrations and `db/schema.ts` ask the owner.

## Left to the builder

- How a derived Recording is stored (nullable Original or a kind), and the break's interval (column or summary field).
- The joined sample series' layout across channels; how rules skip the break's edges.
- The route names (`POST /api/dives/{id}/continuation`-style) and response shape, following the merge routes.
- Which module computes the joined summary; reusing the Recording summary code where it exists.
