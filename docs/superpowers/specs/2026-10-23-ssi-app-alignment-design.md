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

## Piece 3, settled 2026-10-24

From a second session with the owner, before piece 3's plan. It fills what the "Exchange" section above leaves open.
Recorded in [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md) (amended 2026-10-24).

- **A clash in a manual send from the Dive's page is asked there** (owner): the User is at it, so "Needs your
  decision" would only add clicks. Nothing is sent; the answer lists each clashed field with both values (as `exists`
  does for a dive at the same time), the User picks "keep Dive Hub's" or "take SSI's" per field and sends again with
  the choices. One save at the Provider; the read again in that case is accepted.
- **A clash in a Push run waits in "Needs your decision"** (owner): a run may be 100 paced dives, so it doesn't stop.
  The dive is sent without the clashed fields (they stay as the Provider has them), one entry per Dive and Connection
  waits, and the run's report says how many with a link there. Push runs are the first user of these entries; piece 6
  reuses them. Like gone dives ([ADR 0051](../../decisions/0051-dives-gone-at-a-provider.md)), they are stored per
  Connection and shown on the Review page and in the logbook's strip.
- **An emptied field is a change like any other, both ways** (owner, on the owner's worry that removals would be
  blocked). Today a null in an update leaves the Provider's value (`ssi-record.ts`), so a note removed here stays in
  SSI. With a base: removed here (base had it, the Provider still has it) → sent as a removal; removed at the Provider
  → taken as a removal here; removed on one side and changed on the other → a clash; removed on both → nothing. Without
  a base the Provider's value stays, as today. Exceptions (my call, the owner agreed): the **site** is never cleared by
  the Provider (SSI needs one; ADR 0030 stays); **values from a Recording** are send-only and put back on the next
  send. **Tank and lead** take a removal at the Provider: the Dive's one Cylinder or its one Lead entry is removed,
  unless a Recording brought it. This changes ADR 0031's and ADR 0045's "never removes" (owner: "what I would expect").
- **Dive type** (correction, found while planning): a Dive without a Recording has no dive mode of its own (no column),
  so there is nothing for SSI's dive type to come back into. The send leaves SSI's value there (`null` on an update),
  so nothing is overwritten either; it stays out of the comparison.
- **Word:** the glossary's **Conflict** (a value changed in two places since their last common state) is what this
  design calls a clash; code, API and UI say conflict, as the import preview does.
- **Folded in from piece 2** (owner): the Provider's `fields` governs the send, the import's fill and `asRecording`, not
  only the three-way import; an outgoing test for the `tankPressure` and `cns` channels; one number parser in
  `ssi-dive-type.ts`. **Kept parked:** the 180–86 400 s limit of `si_before` [R] (it needs a check of its own).
- **A send without a base** (owner: "push it out"): a Dive linked to a dive already at the Provider and never imported
  has no base. Its first update sends Dive Hub's values as today, and fills what is empty here from the Provider's
  record; no clash is raised. From then on the sent payload is the base.
- **Resolving an entry** (my call, from the builder check; revised while planning): both choices on the Review page
  run the same send as the Dive's page, with the choices (no queue before piece 6): "take <Provider>'s" is taken from
  the record read in that send, "keep Dive Hub's" is sent in it. One code path, and the Provider's value is fresh, not
  the one stored when the entry was made. A manual send while an entry is open for the Dive and Connection asks those
  fields on the Dive's page and closes the entry. While an entry is open, each of its fields counts as a conflict as
  long as the two sides differ, whatever the base says (the base moved with the send that left the field out).
- **A key the Provider can't clear** (my call): the check whether SSI clears a key sent empty runs early in the plan,
  before the removal is built. A field it can't clear is reported in the send's answer as not removable there, and the
  base moves so it isn't tried again on every send.
- **The check on the owner's account** (announced first): notes changed in SSI's app and lead changed in Dive Hub, then
  a send: the note comes back, the lead goes out, nothing is overwritten. Then a note removed in Dive Hub, a send: it is
  gone in SSI's app (not yet known [?] whether SSI clears a key sent as null or empty).

## Piece 4, settled 2026-10-24

From a third session with the owner, before piece 4's plan. It fills what the "SSI" section's Sites bullet leaves open.
Recorded in [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md) (amended 2026-10-24).

- **Other Users have their own SSI accounts** (owner). A private site at SSI belongs to one SSI account, while a Dive Hub
  site is shared by every User, so a private SSI ID must never be used for another account's dive.
- **One table, with an owning account** (owner, after weighing two tables): `dive_site_external_id` gets
  `account_id`, the account at the Source that owns a private site (below: the Diver's account row); empty = public,
  usable by everyone. One column, not
  a flag plus an account, so the two can't contradict. Why one table: SSI's private and public sites share one ID space
  (`odin_dive_sites_id`), so "an ID belongs to one site here" stays one unique index; and a private site SSI later
  publishes keeps its ID, so it is one value changing, not a row moving. Rules: an ID once per Source (as today); at most
  one public ID per Source and site; at most one private ID per Source, site and account. A private row may carry
  `provides_data` and `imported` (the dive import makes shared sites from private logbook sites, owner 2026-10-06); the
  site's data stays shared, only the ID is private. `site_import_id` stays empty on private rows (the site import never
  delivers them; no rule needed). Generic: any site Source, not only SSI.
- **Reads go through the sites module** (owner): one function answers "the IDs this account may see for this site";
  `mcp/tools-sites.ts`, `site-service.ts` and every other direct reader of the table move onto it. A test shows another
  account's private ID never appears.
- **Which SSI ID a send uses** (owner: public first, no setting):
  - **A new dive at SSI:** the site's public ID; else the account's private one; else a site of the account's logbook
    within 100 m with a matching name (ADR 0021's rule; the send reads the logbook anyway, no extra call), whose ID is
    stored public or private as SSI marks it; else Dive Hub creates the site at SSI as private (`save_divesite`: name,
    position, country, water type) and stores its ID as private to the account.
  - **An update:** when the dive at SSI already points at one of this site's IDs the account may use (public or
    private), it stays there. Dive Hub never moves a dive between the two (an anti-goal: it would change a value the
    User didn't touch, and split the site's dives in SSI's app). A private ID is kept although a public one exists.
  - The same in a manual send and a Push run, with no extra step.
- **What the User sees** (my calls): the requirement `site_external_id` no longer blocks when the site has a position;
  the Dive's page says "Sending finds this site in your SSI logbook or creates it there as a private site", and picking
  an SSI site or typing an ID stays. A Dive without a site still blocks; a site without a position still blocks ("give
  the site a position"; Dive Hub doesn't create a site without a pin at SSI). The site page shows "Your private SSI site:
  <ID>" only to that account's User, who can change or remove it; the public ID works as today.
- **An ID picked or typed by hand** (owner): picked from the account's logbook sites, it is stored as SSI marks it
  (`is_private` and owner). Typed, Dive Hub asks SSI for it (`get_divesite`, `dsid` [R]; one call, only on the User's
  action): an ID SSI doesn't know is refused (the User mistyped it); SSI's answer decides public or private. Where the
  answer doesn't say, or SSI can't be reached, the ID is private to the account (the safe side: only other Users lose).
- **What `account_id` holds** (owner): a private site belongs to the SSI account, not to a Connection. An SSI account
  is one Diver's here (`diver_external_id`, unique per Source; another Diver connecting it is `provider_account_taken`),
  while Connections are per User, Diver and Provider: several Users managing one Diver (`diver_management`, ADR 0028)
  each have a Connection to the same account. So `account_id` is a foreign key to that `diver_external_id` row, `on
  delete cascade`: removing a Connection keeps the IDs; deleting the Diver or connecting the Diver to another account
  (which replaces the row) removes them; no orphaned data and no clean-up code. The row's Source and the account's
  Source must be the same (both `ssi`); the two enums are separate, so code checks it. "The IDs this User may see" =
  the public ones plus the private ones of the Divers the User manages, for that Source; a send for a Diver uses that
  Diver's.
- **Merging two sites** (my call): the kept site keeps its private ID for an account; the removed site's private ID for
  the same account is dropped (a public or private ID the kept site lacks moves, as today). Dives of the removed site
  then count as changed, and their next update points them at the kept site's ID: merging means that. Both sites stay
  at SSI.
- **Site history** (my call): setting, changing or removing a private ID writes no Revision on the site, whose history
  every User reads. A private ID is the account's own setting.
- **A logbook site whose ID another site here holds** (my call): skipped in the nearby match, as ADR 0021's matching
  skips a site with an ID at that Source; the send goes on to create a site. Two sites here matching one SSI site is a
  duplicate to merge here.
- **Edge cases** (my calls): a site created at SSI whose dive save then fails keeps its ID, so the next send reuses it;
  two dives at one new site in a Push run create one site (sends on a Connection run one at a time); deleting a site or
  a Dive here never deletes the site at SSI (ADR 0056: the site is never cleared).
- **The import** (my call): a logbook site SSI marks private (`odin_dive_sites_is_private`) and owned by the account
  (`_is_private_owner` = the Connection's account) is stored as that account's private ID. The owner's private IDs
  already on shared sites become private on the account's next logbook read; no migration guesses. When SSI reads a
  site as public whose row here is private (SSI published it), `account_id` is cleared.
- **Checks on the owner's account, before anything is built on them** (announced each time):
  1. What `save_divesite` answers: the new ID in the answer, or a read has to find it. Whether a site can be deleted
     again (`odin_dive_sites_deleted`). If it can't, the owner is asked before the next check leaves a test site behind.
     What `get_divesite` answers for one of the owner's private sites, a public site and an ID that doesn't exist
     (whether it carries the privacy flag and owner; how an unknown ID is answered).
  2. **"Usable and not visible to others"** (owner: enough from one account): Dive Hub creates a private site "Dive Hub
     test", a 2000-01-01 test dive uses it, the owner sees the site on the dive in SSI's app; the logbook returns it
     `is_private: 1` with the owner as owner; it is in neither `get_divesites_global` (read right after, with a
     `last_sync` before the creation) nor the public zip of the next day. Then the dive and the site are deleted. It
     doesn't prove another account can't use the ID directly; accepted.
- **Later** (owner): when a site that an account holds privately gets a public SSI ID, "Needs your decision" offers to
  move the account's dives to the public site or keep them. The decision only changes Dive Hub's side; the Dives then
  count as changed since sent and go out with whatever send comes next. Draft:
  [backlog 0003](../../backlog/0003-private-site-gets-public.md). For piece 6: whether a resolved Conflict entry should
  likewise only mark the Dive for sending instead of sending at once (piece 3 sends at once, as no queue exists yet).

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
