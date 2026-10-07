---
title: Why Suunto-file Dives did not match their SSI dives
summary: Read-only diagnosis of 12 unmatched Suunto Dives plus a comparison of the 38 not yet imported files; the SSI start times differ by a different amount on each trip and never by a zone, so the cause is the SSI entries (B), with one mislabelled Suunto file.
status: draft
date: 2026-10-07
---

# Why Suunto-file Dives did not match their SSI dives

Investigation only: SELECT queries on the dev database, no data changed, nothing pushed, no SSI call (the SSI dives
are stored locally as Dives with `from_provider = 'ssi'` and a `link` Push, so no live call was needed). Exact values
are limited to what the tables need. Rule and tolerance: [ADR 0030](../decisions/0030-importing-dives-from-providers.md),
[matching.ts](../../apps/server/src/imports/matching.ts) (`overlaps`, 5 minutes on both ends of the span, then a depth check; the matching reads the Dive's spans, not the day).
Suunto offsets: [ADR 0037](../decisions/0037-suunto-file-import-and-file-formats.md) decision 7.

## What was found

20 current Dives have a Suunto Recording (`suunto-json`). 8 are linked at SSI, **12 are not** (as the brief said):
one from 2019 and eleven from a single trip in 2023 (30 Sep to 4 Oct, offset +3 h, source `device`). All 20 are of the
same Diver.

| # | Local day (Suunto, stored offset) | Suunto local | SSI no. | SSI local | SSI minus Suunto (min) | Depth (SSI vs Suunto) | Duration (min) | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | 2019-03-29 | 11:05 | none | none | none | none | 27 | SSI logbook lacks it (entries start 2023-04-21); owner: the computer's clock was set wrong |
| 2 | 2023-09-30 | 08:49 | 26 | 10:55 | 125 | same (0.1 m) | 38 / 37 | start time differs, ~2 h |
| 3 | 2023-09-30 | 13:53 | 27 | 16:10 | 137 | same | 47 / 46 | as 2 |
| 4 | 2023-10-01 | 07:29 | 28 | 09:35 | 126 | same | 41 / 40 | as 2 |
| 5 | 2023-10-01 | 12:25 | 29 | 14:31 | 125 | same | 40 / 40 | as 2 |
| 6 | 2023-10-01 | 18:14 | 30 | 20:21 | 127 | same | 35 / 35 | as 2 |
| 7 | 2023-10-02 | 08:38 | 31 | 10:36 | 118 | same | 42 / 40 | as 2 |
| 8 | 2023-10-02 | 13:47 | 32 | 16:46 | 179 | same | 48 / 47 | as 2, but 1 h more |
| 9 | 2023-10-03 | 07:35 | 33 | 09:49 | 133 | same | 42 / 40 | as 2 |
| 10 | 2023-10-03 | 13:54 | 34 | 16:03 | 129 | same | 45 / 44 | as 2 |
| 11 | 2023-10-04 | 13:16 | 37 | 15:43 | 147 | same | 48 / 48 | as 2 |
| 12 | 2023-10-04 | 17:34 | 38 | 19:48 | 133 | same | 43 / 43 | as 2 |

Rows 2 to 12 are the eleven Egypt-trip dives; each has exactly one SSI entry that fits on depth and duration.

## Findings per cause

- **Not whole hours.** The differences are 118 to 179 minutes, never 60/120/180. A pure zone or DST error in the SSI
  conversion would give a whole number of hours. Egypt was on summer time (UTC+3) from 28 April to 26 October 2023, and
  both sides use +3 (`utc_offset_seconds = 10800`: Suunto from the file, SSI from the Site position), so the SSI
  conversion is not the cause.
- **Depth is the same to 0.1 m in every pair and the duration differs by 0 to 3 minutes** (SSI keeps whole minutes).
  So the SSI entries describe these very dives; only the start differs. This is not "a different dive".
- **The matched group looks different.** The 6 auto-attached pairs (`revision` cause `auto-attach`): the three German
  dives of 2023-09 differ by 0 to 1 minute, the 2025 dive by 2 minutes. The two Egypt dives of 2023-10-04 differ by
  46 and 32 minutes (they matched only because the spans overlap, not because the starts agree).
- **One Suunto start is internally inconsistent**: the first Egypt dive of 2023-10-04 carries `+01:00` while its
  neighbours carry `+03:00`. Its `surfaceIntervalSeconds` (the watch's own count since the previous dive) puts it
  2 hours (7187 s) earlier than the stored instant. All 17 other consecutive pairs agree with their surface interval
  within 70 seconds. So that file's wall-clock is right and its offset label is wrong by exactly the +3 versus +1.


## Contrast: the 38 Suunto files not yet imported

`samples/private/suunto/` holds 58 files, the database 20. The other 38 (2024 to 2025) were compared read-only: the file's
local start against the stored SSI dives of the Diver, same depth and duration within 15 percent, within 6 hours. "SSI minus
Suunto" in minutes; only pairs with exactly one candidate count for the range.

| Trip (place, files' offset = SSI's offset) | Dives | SSI minus Suunto (min) |
|---|---|---|
| Germany, 2023-09 and 2025-07 | 4 + 8 | -1 to 3 (one 2023-09-17 dive paired with a wrong 186-minute candidate, ignored) |
| Canary Islands, 2025-02 | 3 | 0, 1 and 59 |
| Egypt, 2023-10 (+03:00) | 11 | 118 to 179, median 129 |
| Egypt, 2024-04 (+02:00) | 16 (2 short dives without a candidate) | 71 to 87 on seven dives 20 to 23 April; 17 to 276 on the rest |
| Thailand, 2024-05 (+07:00) | 2 | 60 and 63 |
| Malta, 2025-03 (+01:00) | 4 | 70 to 225 (two candidates on two of them) |
| Germany, 2024-03 (+01:00) | 4 | 42 to 191 (two or three candidates each, pairing uncertain) |

On every trip the file's offset equals the offset Dive Hub derived for the SSI dive from the Site position, so a zone label cannot
explain the shift. The Egypt dives of April 2024 have no zone difference at all (both +02:00) and still differ by about 77 minutes,
which is neither a whole hour nor the 2 h of October 2023.

## What the new "Show when each dive was made" button showed

The owner ran the read-only list (`GET /api/connections/{id}/dive-times`) on the real SSI logbook: 90 entries.

- **"Record created" is empty for every entry.** SSI's logbook read does not return a creation time for these dives, so
  *when* an entry was typed cannot be compared with the dive's day.
- **"Made by":** 87 entries are typed by hand, 3 come from a dive computer (2023-09-17, 2025-03-22, 2026-08-23), 1 was sent by Dive Hub.
- **"Confirmed by dive centre" is on almost every entry**, the shifted trips and the exact ones alike (for example the
  2025-07-07 dives that agree with the watch to 2 minutes). It does not separate the two groups.
- **"Confirmed by dive leader"** is on only 6 entries (2023-09-03, 2023-09-17, 2025-02-12/17/19): five of them agree with
  the watch to the minute, one (2025-02-19) is 59 minutes off. Every shifted Egypt, Thailand and Malta entry lacks it.
  A hint, not proof: six entries.
- The shifted times are minute-precise (09:35, 14:31, 20:21) and the depths are the watch's to 0.1 m, so the entry was
  typed from the watch's data with a start time two hours (Egypt 2023) or about one hour (Egypt 2024, Thailand) later.

- **How SSI verification works (owner, 2026-10-07):** every dive is logged by a diver; a dive centre then verifies it by
  scanning the diver's QR code, and changing a time afterwards removes the verification. So "confirmed by dive centre"
  says only that the centre scanned the entry as it then stood. It does not say who wrote the start time, and an earlier
  reading of mine that the centres recorded these times was wrong. Only three entries are unconfirmed (#19 and #68 from a
  computer, #91 sent by Dive Hub); every hand-typed entry is confirmed, whether its time agrees with the watch or not.
  The exact ones may have been corrected by the owner and verified again afterwards; that cannot be seen here.

So the start time of each shifted entry was written by a diver (the owner, or copied from another diver's log) and left as
it was when the centre scanned it. Why it is 1 to 2 hours after the watch is not in SSI's data; the owner's memory of how
the Egypt, Thailand and Malta entries were logged (typed on the spot from the guide's board, copied from a buddy, or from
the phone's app) is the missing piece.

## SSI entries that overlap each other

A diver cannot be in two dives at once, so overlapping entries show start times that are wrong whatever the watch says.
Five pairs in the Diver's SSI logbook overlap (SSI no. 24/25 on 2023-09-23, 40/41 on 2024-03-29, 56/57 on 2024-04-25,
64/65 on 2025-03-20 and 66/67 on 2025-03-21), by 27 to 41 minutes of a 28 to 44 minute dive; the starts are 1 to 15 minutes
apart. On Malta (2025-03) both days are such pairs, while the watch has them well apart (two dives about 1 h 40 apart on
the 20th). The owner confirms that the Thailand and Malta dives were not night dives, so time of day gives no test there; this
one does. It shows those starts were not copied from the watch, and none of the five entries was edited afterwards
(each is still verified). Egypt 2023-10 has no overlaps and keeps the watch's gaps to the minute, with a constant shift, so it
needs another explanation than "typed in a batch".

- **Owner's view on Egypt (2026-10-07):** leans to the Suunto times being right. Taken as that (a recollection, not proof), the
  Egypt 2023 SSI entries are 2 h too late, the stored Suunto instants are right, and Dive Hub's handling of the files is not at fault,
  apart from the one file labelled +01:00 (its wall-clock is right, its stored instant is 2 h late). The remaining question is
  where the SSI times came from: the gaps between dives match the watch to the minute with a fixed shift of about 2 h 6 min a day.

## Verdict

**(B) for the eleven Egypt dives of 2023-10 and by the same pattern for most other trips; a small (A) on one file.**

- The shift is trip-specific and not a zone effect: 0 to 3 minutes at home and in the Canary Islands, about 2 h 10 in Egypt in
  October 2023, about 1 h 15 in Egypt in April 2024, about 1 h in Thailand, scattered on Malta. A time-zone or DST defect
  would repeat the same whole-hour error for the same place and date.
- Depth is the same to 0.1 m and the duration differs by at most a few minutes, so these are the same dives; only the SSI start is
  off. That matches what the owner said: the SSI dives were typed by hand or taken from someone else's logbook, with rounded
  times. A dive centre's or buddy's times on a trip will be later and scattered. This corrects my first reading in the earlier
  draft of this note, which fitted a constant 2 h and read it as a wrong offset in the Suunto files; the later trips show there is
  no constant to fit.
- **Row 1 (2019):** neither; the SSI logbook starts in April 2023, and the owner says that computer's clock was set wrong.
- **A small (A):** one Egypt file (`2023-10-04 07:41`, +01:00) carries the wrong offset label; its wall-clock is right, so the
  Dive's local time shows correctly, but the stored instant is 2 h too late (the surface-interval chain proves it). Not a Dive Hub
  code defect: the file says +01:00. ADR 0037 decision 7 trusts it.
- Dive Hub itself does not misbehave: the 5-minute tolerance is correct for entries copied from the computer (the German dives
  match to the minute) and cannot cover typed times that are 1 to 3 hours off.

## What can be done (proposals only, nothing changed)

- **Owner:** correct the SSI start times of entries 26 to 34, 37 and 38 (2023-10) and of the April 2024 entries, or accept the
  link by hand.
- **Match rule:** keep the 5-minute rule, and add a *suggestion* (not an automatic attach) for a Suunto Recording and an SSI-sourced
  Dive of the same Diver on the same local day with maximum depth equal to 0.1 m and duration within 3 minutes, whatever the
  start. Every pair in this note would qualify; the two Egypt candidates on 2023-10-01 and 2024-04 would need the depth check
  to tell them apart. This is a change to [ADR 0030](../decisions/0030-importing-dives-from-providers.md) and needs its own ADR.
- **Offset check (for the mislabelled file):** compare a Suunto file's instant with its neighbours by `surfaceIntervalSeconds`
  and mark an offset that disagrees by more than a few minutes as `unknown`, or show a logbook-check finding. If done, load `tdd`
  and `vitest` and read their [overrides](../skills.md#overrides). Test sketch: two same-day Suunto Recordings, the second with
  `surfaceIntervalSeconds` of 10 000, labelled +03:00 and +01:00; assert the second is flagged. (Invented values.)

## Open

- Repeat the count with: Suunto Recordings whose Dive has no `confirmed` SSI Push with a `remote_id`.
- The 2024-03 and 2025-03 pairings are ambiguous (several candidates); a manual look would settle them.
- That the Suunto app attaches the phone's zone at sync is from [the import research](2026-10-07-suunto-import.md), not newly verified here.
