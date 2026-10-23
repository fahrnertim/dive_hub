---
title: SSI aligned with its app, and two-way exchange for every integration
summary: Dive Hub's SSI integration follows what the decompiled SSI app (5.0.43) proves instead of community guesses, exchanges everything both platforms hold in both directions with clashes asked in "Needs your decision", creates missing sites at SSI as private ones, adds buddies to the SSI buddy list, and gets manual, on-change and scheduled exchange in the shared integration layer; seven pieces in order, gear later with equipment; checks on the owner's account recorded with a new [T] marker.
status: approved
date: 2026-10-23
---

# SSI aligned with its app, and two-way exchange for every integration

Design from a brainstorming session with the owner on 2026-10-23. Recon: the
[review note](../../research/2026-10-23-ssi-decompilation-review.md) and the seven decompilation notes of 2026-10-22 it
lists. "Owner" marks what the owner decided; "my call" marks what the designer decided and the owner may overturn.

## Intent

Until now the SSI integration rested on community projects' captures and our own guesses. The decompiled app shows how
SSI built its API, and Dive Hub should follow it (owner). Two goals beyond correctness (owner):

- **Everything both platforms hold is exchanged, both ways.** New data is part of the same alignment, not a later step.
- **What only SSI has is written down** as candidates for Dive Hub features, not built here.

## Goals

1. Dive Hub talks to SSI as the app does: the full dive record (345 keys, the app's types), the app's way of reading
   answers (2xx, a body `status: 401` as signed out under any HTTP status, 503 as maintenance), one record per call.
2. Every value that exists on both sides travels both ways (list in piece 2).
3. A change made on one side since the last exchange reaches the other; a change made on both sides to different values
   is asked, never overwritten silently.
4. A dive whose site has no SSI ID can still be sent: Dive Hub creates the site at SSI.
5. Participants reach SSI's buddy list when Dive Hub knows who they are.
6. Exchange can be started by hand, on change (Dive Hub side), and on a schedule, for **every** integration.
7. Every claim about SSI says where it comes from: app code, our own test, others' reports, or unknown.

## Non-goals

- **Gear and gear sets** are not exchanged in this work. They wait until Dive Hub's equipment items are built
  separately (owner). See "For the equipment work" below.
- **Verifying dives** (`divelog_verify`) is not built: [ADR 0043](../../decisions/0043-dive-centres-and-ssi-verification-codes.md)
  says Dive Hub never verifies a dive itself. It goes on the "only SSI has" list.
- **Public sites at SSI.** Sites are created private (owner).
- Account, profile, privacy, sign-up, courses, social and content calls of the app.

## Anti-goals (a failure even if it works)

- An update from Dive Hub erases anything the User typed in SSI's app.
- Two quick edits to a dive cause two saves, or an undone edit causes one.
- A rounding difference SSI makes itself (minutes, leading zeros, 0 for "nothing") shows up as a clash.
- A scheduled run reads SSI more often than SSI's app does (its logbook at most hourly).
- A test write on the owner's account that isn't announced, isn't recorded, or isn't cleaned up.
- The password reaches the agent's conversation.

## Constraints

- SSI's API is private; every write goes to the owner's real account. The User-Agent rule of
  [ADR 0049](../../decisions/0049-ssi-app-user-agent.md) stays.
- The provider seam of [ADR 0027](../../decisions/0027-providers-as-adapters.md): no `odin_*` key outside
  `providers/ssi/`; shared behaviour (clash handling, queue, schedule) lives in the generic layer and works for any
  Provider. Module rules of [ADR 0053](../../decisions/0053-module-boundaries.md).
- Tests never reach SSI; they use `test/fake-ssi.ts`. Facts about SSI come from the app's code [R] or a check [T].
- `apps/server/src/providers/`, migrations, `db/schema.ts` and `docs/decisions/` are protected paths: each edit asks
  the owner.

## Decided

### Exchange (owner)

- **Clash rule.** Per field, against what both sides had at the last exchange (the base). Changed on one side only:
  that change goes through. Changed on both sides differently: a clash. Clashes from a run without the User (a
  scheduled fetch, a send on change) wait in **"Needs your decision"** (ADR 0038's place) and the rest of the dive or
  item is exchanged; in a manual import's preview they stay where they are today. Differences SSI makes itself are
  compared away as the read-back and the import already do.
  - **What changes:** the import already works this way ([ADR 0030](../../decisions/0030-importing-dives-from-providers.md),
    amended 2026-10-06; `three-way.ts`). The **send** does not: an update puts Dive Hub's non-empty values over SSI's
    record without asking whether SSI changed them since the base. The send gets the same three-way rule, so a field
    changed only in SSI's app comes back into the Dive instead of being overwritten.
  - **No extra read:** an update already reads SSI's current record first (`ssi-adapter.ts`, `update` → `byId`), so
    the send compares against it at no extra cost. A value taken back during a send is a normal Revision ("Updated from
    its source"); the Push then records the fingerprint of the merged result, so it doesn't queue the Dive again (my call).
  - **Values from a Recording** follow ADR 0030's rule (my call): on a Dive with a Recording, the computer's values
    (samples, tank pressure, CNS, heart rate, dive mode, surface interval, start, duration, depths) are send-only;
    SSI's edits to them aren't taken back. On a Dive without a Recording, the scalar ones come back three-way as today.
    Dive type and tank and lead follow the same split.
  - **An unattended clash** (my call): one "Needs your decision" entry per Dive and Connection listing the clashed
    fields, each with "keep Dive Hub's" or "take SSI's". While it is open, the base stays as it was and the clashed
    fields are neither sent nor taken back; the rest of the dive is. "Keep Dive Hub's" queues a send; "take SSI's"
    writes a Revision. Resolving moves the base, so the same clash isn't raised again until a side changes again.
- **Three ways to run** (owner), all in the generic layer:
  1. Manual, as today.
  2. **Send on change**, optional per Connection, Dive Hub side only. Updates a Dive already linked to the Connection.
     Two more settings on the Connection, both off by default and both generic (owner):
     - **"Send new dives automatically"**: a new Dive goes to the Provider through the same queue and quiet period.
     - **"Delete at <Provider> when I delete here"**: the delete waits through the quiet period, so an Undo in that time
       cancels it. The setting says that restoring the Dive later creates it at the Provider again as a new entry, and
       that a verification it had there is lost. Off, deleting asks as today (ADR 0026).
  3. **Fetch on schedule**, optional per Connection, running the same import as a manual one. A dive found only at
     the Provider becomes a Dive exactly as a manual import makes it (owner): no extra review list.
- **Coalescing** (owner asked, my call on the how): one waiting entry per Dive and Connection, not per edit; the Dive
  is read when it is sent; it waits for a quiet period (my call: 2 minutes) before sending; nothing is sent when the
  fingerprint equals the last sent one; a change during a send queues the Dive once more.
- **How often** (my call): each Provider declares the shortest interval at which it may be read on a schedule; SSI
  declares 1 hour (its app's logbook rate). A Connection can't be set below it.
- **Unattended sign-in** (my call, from ADR 0024's choice at connect): a Connection that keeps the sealed password
  renews an expired token by itself; one that keeps only a token pauses its schedule and queue and shows the existing
  `provider_sign_in_needed` state on the Connection (no new notice).
- **What a scheduled fetch can't decide** (my call): where a manual preview would ask (several candidates, a probable
  non-dive), the scheduled Import skips the entry as `ambiguous`, as today, and the Connection shows how many wait, with
  a link to a manual import that asks. ADR 0030 kept these out of "Needs your decision"; that stays.

### SSI (owner)

- **Sites:** a Dive whose site has no SSI ID gets one: Dive Hub first looks for an SSI site nearby (the existing 100 m
  plus name matching, ADR 0021) and takes it if found, as the import already matches sites; else it creates the site at
  SSI **as private** (`save_divesite`). The same in a manual and an unattended send, with no extra step (my call, so a
  push run doesn't stop to ask); the site's new SSI ID is shown on the site and can be changed there as today.
  The blocking requirement `site_external_id` becomes something the send can fix.
- **Buddies:** a Participant missing from the User's SSI buddy list is added with `save_buddy` (owner): always when
  the Diver has an SSI account (linked to it) or an e-mail; with a name only **if** a check [T] shows SSI keeps such an
  entry (saved, listed in the app, usable on a dive), else left out as today. No duplicates: an entry is matched by SSI
  account, then e-mail, then exact first and last name, and the entry ID is remembered for the Diver after the first
  send. The list is read with the app's own call `get_buddies` (`user_buddies`) instead of `logbook_buddies`.
  Not in scope: finding a person's SSI account by name (`search_buddy`); if ever built, only as a suggestion the User
  confirms.
- **Checks on the owner's account** (owner): allowed, each announced before it runs. Access: the owner signs in once in
  their own terminal (`round-trip.ts read`), the token stays in git-ignored `samples/private/ssi/`, the agent runs the
  check modes with it; on expiry the owner signs in again. Test data is dated 2000-01-01 or named "Dive Hub test" and
  deleted afterwards (SSI keeps deleted dives hidden; that trace is accepted).
- **Provenance** (owner): a new marker **[T] tested on the owner's account** beside [R], [S] and [?]. Each check gets a
  dated research note (what was sent by key name, what SSI stored, the result, the app version); the SSI reference
  marks each claim and links the note. Each check is a mode of `round-trip.ts`, so it can be repeated.

### Architecture (owner: with the piece that needs it, not as a clean-up first)

| Change | Piece |
|---|---|
| One declaration of SSI's dive row (345 keys and types) for empty record, writable copy, typed reads and the serializer; a test against the key table | 1 |
| One SSI transport for the envelope rules; each call a small typed function on it | 1 |
| One dive shape for import and export (`ProviderDive` core); a Provider declares per field which directions it takes | 2 |
| Three-way rule on the send; "Needs your decision" entries for unattended clashes; generic | 3 |
| Send queue and schedule in the generic layer | 6 |
| Read-back against the save's own answer (`result.dive`), one logbook read per run to confirm storage | 7 |

## The pieces, in order

Each piece is one plan and one branch, and ends with working, tested software. Piece 3 comes before 6 (my call):
automatic exchange without clash handling would overwrite edits made in SSI's app.

1. **Foundation.** Dive-row declaration and transport (above). Fixes from the review: the six keys an update drops
   (`odin_user_log_gear_details`, `log_extended_data_latitude`, `_longitude`, `_conservatism`, `_decomodel`,
   `_libdivecomputer_identifier_base64`), and the writable copy takes every key of the app's row (plus `odin_user_log_date` and `_entry_time`, which the app
   also sends) from SSI's record, and nothing else, as the app does; `o` in samples is "open
   circuit" (true for open circuit); booleans as booleans; a body `status: 401` is `signed_out`; 503 is a maintenance
   reason; outdated comments. The check modes and the [T] marker. **Checks first:** do gear notes survive an update
   today; how does an expired token answer `get_divelog`.
2. **Everything a dive has on both sides, both ways.** Dive type (Dive Hub's kind and the Primary recording's dive mode
   → SSI's `odin_user_log_dive_type`: apnea 6, CCR 8, SCR 4, two or more gases 2, else 0; and back), the tank (one
   Cylinder: volume, start and end pressure, tank type 19/20, bar and psi), lead (`weight_kg`/`_lb`), surface interval
   (minutes), tank pressure in the samples (`pr: {t, v}`) and `tankPressureDataset`, CNS and heart rate where the
   Recording has them. The `ProviderDive` shape. **Checks:** a freedive shows as one in SSI's app; the pressure curve
   shows.
3. **Two-way with clash handling** (above). **Check:** a field changed in SSI's app, then a send from Dive Hub: the
   change comes back, nothing is overwritten.
4. **Sites** (above). **Check:** a private site created by Dive Hub is usable on a dive and not visible to others [?
   how to see that from one account is for the builder to find].
5. **Buddies** (above). **Checks:** an added entry appears in the app's buddy list and on the dive; a name-only entry
   is kept (decides whether name-only buddies are added).
6. **Automation** (above), for every Provider.
7. **Fewer reads** (above).

**Later:** gear and gear sets, after equipment.

## For the equipment work (owner, recorded here so it isn't lost)

Equipment items ([ADR 0034](../../decisions/0034-equipment-items-and-service-schedules.md), not built yet) need **item groups**: a base
set the Diver takes on nearly every dive (e.g. computer, regulator, BCD), added to a dive in one step, with items that
vary (e.g. the suit) added one by one. Groups line up with SSI's gear sets, so the later gear exchange covers items,
groups and which items were on each dive (SSI's `odin_user_log_gear`).

## What only SSI has (candidates, not built)

From the app's code [R]. For the owner to pick from later.

| Area | What SSI keeps | Where |
|---|---|---|
| Verification | a dive centre's or professional's confirmation (QR, `divelog_verify`) | ADR 0043 forbids doing it ourselves |
| Conditions | visibility, air temperature, entry type, current, surface, weather, water body, dive purpose and special dive | `_vis_m`, `_airtemp_c`, `_var_*_id` |
| Rating | the diver's rating of the dive | `odin_user_log_rating` |
| Wildlife | animals seen on a dive; SSI's species list | `odin_user_log_animal_ids`, `get_wildlife_vars` |
| Freediving | disciplines with warm-ups and maxima (STA, DYN, CWT, FIM, …), freediving suit, weight, neutral depth | `odin_user_log_frddisc_*`, `_frd_*` |
| Technical | extended range, SCR and CCR blocks: back and deco gases, setpoints, bailouts, SAC per phase | `_xr_*`, `_scr_*`, `_ccr_*` |
| Logbook history | dives before the logbook, totals per kind | `get_divelog_history`, `user_no_dives` |
| Emergency contacts, insurance | per diver | `get_emergency_contacts`, `get_insurance` |
| Dive centres | centres near a place, the diver's affiliations | `get_dc_data`, `getaffiliations` |
| Site content | descriptions and images per site | `save_divesite_descr`, `save_image` |
| Badges | achievements | `get_user_badges` |

## Left to the builder

- Names, files and signatures, within ADR 0053.
- The quiet period's exact length and where the queue lives (a table, or Graphile Worker jobs with a key).
- How a Provider declares per-field directions and its schedule interval in `Capabilities`.
- Which pieces need a migration; the client contract ([docs/spec/clients.md](../../spec/clients.md)) for new settings
  and notices.

## ADR drafts (status proposed)

- **[ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md) Two-way exchange and automation** (generic): the clash rule on the send, "Needs your decision" for
  unattended clashes, send on change with coalescing, the two settings for new and deleted Dives, the schedule with a
  per-Provider interval, unattended sign-in. Amends 0026, 0027, 0030, 0038, 0047.
- **[ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md) SSI aligned with its app**: the app as the source of truth with [R]/[T], the full record, the data now sent
  (amends 0031 and 0045 "not sent"), private sites created at SSI (amends 0024, 0029), buddies added (amends 0029),
  read-back against the save's answer (amends 0047), checks on the owner's account.
