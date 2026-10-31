---
title: "ADR 0062: Garmin as an import-only Provider whose dives come as files"
summary: Garmin Connect (Personal API) is a Provider with token sign-in by the User's own key, dives import only; its dives come as the computer's original FIT files, stored as Originals and placed like uploads under the file's own Recording key, so an upload and a fetch of the same dive are one Recording and a fetch never replaces one already here; every Connection gets a choice of the kinds of dive to fetch (scuba, apnea; both by default), SSI too; the key's expiry is an optional date. Amends ADR 0027 and 0030.
status: accepted
date: 2026-10-31
---

# ADR 0062: Garmin as an import-only Provider whose dives come as files

## Status
Accepted – 2026-10-31 (owner, after the [design](../superpowers/specs/2026-10-31-garmin-provider-design.md)).
Amends [ADR 0027](0027-providers-as-adapters.md) (an adapter may declare dives that come as files and need no export)
and [ADR 0030](0030-importing-dives-from-providers.md) (the per-computer choice and "its files are better" don't apply
to such a Provider; a fetch never replaces a Recording already here; the kinds of dive to fetch).

## Context
Garmin's Personal API (autumn 2026, [reference](../references/garmin-connect-personal-api.md)) lets a person read
their own Garmin Connect data with a key they create: every dive with its original FIT file. Dive Hub reads those
files already. The API is read only, the key is personal to its owner (Garmin's terms), and Garmin publishes no rate
limits. The Provider layer so far knows dives as JSON records (SSI), each with a per-computer choice.

## Decision
- **Provider `garmin`**, sign-in `token`: each User pastes their own key (the form links to Garmin's key page); it is
  kept sealed, as it is needed for every fetch. No terms notice: Garmin makes the User accept its terms for a key. A
  key of another Garmin account on signing in again is refused (`provider_other_account`). The User may enter the
  key's expiry date (Garmin can't be asked for it); the Connection then says from a week before that it expires.
- **Import only.** Capabilities: `dives.import` with `list`, no export, no Provider `fields`: nothing of a dive is
  followed from Garmin's listing, everything comes from the file, and no Conflict can arise.
- **Dives as files.** An adapter may declare `dives.file(context, remoteId)`: the dive's file. The generic import
  stores it as the Original (for Garmin the unzipped FIT) and reads it with the file formats, instead of a JSON record.
  Such dives are placed like an upload: no per-computer choice, no "files are better", the Connection's Diver for a
  Device not seen before.
- **One Recording per dive.** A Recording from a file keeps the file's own Recording key, the same as an upload of it.
  A fetch never replaces a Recording already here under that key; it only links the Dive to the remote dive, so the
  dive isn't downloaded again. An upload by hand replaces as before.
- **A complete read every fetch.** The listing is the whole account's dives; only dives not linked yet are
  downloaded, one at a time with a pause.
- **The kinds of dive to fetch**, per Connection, for every Provider with a dive import: a subset of `DIVE_KINDS`
  (`scuba`, `apnea`), both by default. A dive of a kind not chosen is skipped and the preview says so.

## Consequences
- A Garmin diver's dives arrive with their full computer data without handling files; an earlier upload of the same
  file and a later fetch end in one Recording.
- Turning a kind on later takes in the older dives of that kind at the next fetch (the read is complete).
- Garmin's later edits (the activity name) are not followed; the original file is kept.
- No sending to Garmin, ever: its Connection offers no Push and none of ADR 0056's sending automation.
- A User whose key expired sees `needs_sign_in` and pastes a new key; with an expiry date they are told a week ahead.
- Garmin may throttle without notice: one fetch is one listing plus one download per new dive.
