---
title: Oceanic+ UDDF export (research)
summary: What is public about the Oceanic+ app's UDDF export - one sanitised sample (Submersion's test file), forum and changelog hints - and what it means for an Oceanic+ import in Dive Hub; files first, the cloud API later.
status: done
date: 2026-11-03
---

# Oceanic+ UDDF export

The owner asked for an Oceanic+ import, files first, like Garmin (file, then API); real files from an Apple Watch
Ultra follow later. The findings are in [references/oceanic-plus.md](../references/oceanic-plus.md); this note keeps
the sources and what is uncertain.

## Sources
- **The only real file found:** Submersion's test fixture
  <https://github.com/submersion-app/submersion/blob/main/test/dives/issue_279_oceanic_plus_export.uddf>, added in
  <https://github.com/submersion-app/submersion/pull/1458> (sanitised: coordinates rounded, dates −8 years). Nine dives,
  1,542 waypoints. Read in full on 2026-11-03; all nine dives parse with Dive Hub's UDDF adapter. GPL-3.0, so it is not
  committed here.
- **The export exists and goes by email:** <https://github.com/submersion-app/submersion/issues/279> (Apple Watch Ultra
  2; Submersion read the decimal `divetime` as an integer and lost the profile).
- **Since Oceanic+ 2.0, the whole logbook as UDDF; MacDive imports it but loses some detail (ppO2):** MacDive forum,
  <https://www.mac-dive.com/forum/viewtopic.php?p=15409> (seen as a search snippet only; the page refuses fetching).
- **What the cloud data holds, by a third-party converter:** Dive Converter's App Store history,
  <https://apps.apple.com/us/app/-/id6446218356>: up to three tanks (Oceanic+ 4.0), entry and exit locations that
  can be missing, a "pressure" that is ambient pressure, not tank pressure, no surface intervals, no-fly time and
  maximum altitude. It signs in with the Oceanic+ account's email and password
  (<https://www.iphone-ticker.de/dive-converter-exportiert-oceanic-tauchgaenge-in-uddf-209425/>); how it reaches the
  data is not public.
- Subsurface, libdivecomputer, divelogs.de: nothing Oceanic+-specific found.

## What it means
- A **lenient UDDF reader** (ADR 0003) covers the export; the Oceanic+ dialect needs two rules (the offset, the key)
  and nothing else so far.
- **The offset quirk** (`-00:04` for UTC−4) is the main risk: it is consistent across the sample's three regions and
  seasons, but the sample was sanitised. The owner's files settle it.
- **An Oceanic+ Provider** (account sign-in, fetching dives like Garmin's) needs the cloud API, which is not public;
  that is reverse engineering and a decision first. Backlog [0018](../backlog/0018-oceanic-plus-import.md).
