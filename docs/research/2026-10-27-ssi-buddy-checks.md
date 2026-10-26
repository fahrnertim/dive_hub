---
title: SSI checks of the buddy list (get_buddies, save_buddy, search_buddy)
summary: On the owner's account (app 5.0.43) get_buddies returns the same entries as the dive read; save_buddy adds an entry with name and e-mail and no account, and one with a name only, both kept and shown on a dive in the app (after its buddy sync); an entry is updated in place by its ID, and one added from scratch can be given an account later, which SSI fills from that person's profile (no merge, so duplicates are the client's to avoid); a delete is the flag deleted 1. search_buddy searches all SSI users and names the account of a person who doesn't allow it; with an account alone SSI hands out the person's e-mail and town (privacy flaws at SSI; Dive Hub uses neither; a report is parked).
status: in progress
date: 2026-10-27
---

# SSI checks of the buddy list

Run by the controller with the kept token on 2026-10-27, each step announced in the session, as `round-trip.ts buddy …`
(modes in `apps/server/test/fixtures/ssi/buddy-checks.ts`). Account 3664600, MySSI app 5.0.43. [T] tested on the owner's
account. Background: [SSI app API](../references/ssi-app-api.md#buddies-checked-2026-10-05), the design's piece 5
([design](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md)). Test entries are named "Dive Hub" / "test …",
the test dive is dated 2000-01-01 with notes "Dive Hub test". The output printed no real person's name, e-mail or account.

## What the app sends [R]

From the app's compiled code (Blutter output, see [the API surface note](2026-10-22-ssi-app-api-surface.md)):

- **Two ways to add a buddy in the app:** "Create new Buddy (QR Code)" and "Create new Buddy (from scratch)" ("input all the
  information of the new buddy such as name, email, phone number").
- **`save_buddy`** sends the app's whole buddy row as `json_data`: `id`, `localRefId`, `address`, `dob`, `comment`, `added`,
  `email`, `firstname`, `gender`, `image`, `lastname`, `leader_nr`, `leader_active`, `master_id`, `nickname`, `phone`,
  `deleted`, `needsUpload`, `confirmed`, `favorite`. The buddy's SSI account is `master_id`. The app reads the saved entry
  back from `result.buddy` and puts its new ID on the dives that used the local one.
- **`search_buddy`** (param `string`) is in the API client and the app's AI-assistant tool list; no screen calls it.

## What SSI answered [T]

1. **`buddy read`** (read-only): `get_buddies` answers `{ user_buddies: [...] }`, 8 entries, the same IDs as `get_divelog`'s
   `logbook_buddies`. Keys as in the reference, plus types: `id`, `master_id`, `buddy_master_id` numbers; flags
   (`deleted`, `favorite`, `confirmed`, `leader_active`) numbers 0/1; `dob` and `email` a string or empty; `phone`,
   `leader_nr`, `mobile_c`, `phone_c` a string or a number. Every entry had an account. Every entry with an e-mail had
   `confirmed: 1` (it means mutual, see step 5).
   **Names are not always capitalised:** one entry is stored in lower case, so a name match must ignore case.
2. **`buddy search`** (read-only), `search_buddy` with `string`: it answers `{ info, search, result }`. `search` echoes
   `firstname`, `lastname`, `dob`, `mid` and `string` (so the call likely takes those as well [?]); `info` tells the searcher
   about their own privacy setting and carries a sign-in link to their my.divessi.com profile (a secret: never print or
   commit it).
   - The owner's own name: `result` is one `{ error: "You cannot add yourself as a Buddy. (MID: <own account>)" }`.
   - A buddy's name (a person who left "findable as buddy" off, SSI's default): one `{ error }` saying a user with this or a
     similar name was found, buddy search is deactivated for them, add them by their QR code; and it ends with
     **"(MID: <that person's SSI account>)"**, which was the account of that buddy's entry in the owner's list.
   - What a result for a person who allows being found looks like is not seen yet [?].
3. **`buddy add`**: `save_buddy` with `id: null`, flags as 0/1, `master_id: null`:
   - name and e-mail, no account: answered `{ id: <new ID>, result: { buddy: [ <entry> ] } }` (`result.buddy` is an array
     of one). Kept: `master_id: 0`, `buddy_master_id: 0` (no account), `dob: "0000-00-00"`, `phone: " "`, `added` set by
     SSI, `confirmed: 0`. Listed by `get_buddies` right after.
   - a name only: the same, `email: ""`. **SSI keeps a name-only entry.**
4. **`buddy update`**: the e-mail entry sent again with its ID and another last name: the same entry changed, no new one.
5. **`buddy dive`**: a test dive with both new entry IDs in `odin_user_log_buddy_ids`: stored as sent. SSI gave the dive the
   ID of the test dive deleted the day before at the same date and time (30137120): a create at the time of a deleted dive
   seems to bring that dive back rather than make a new one [?].

   **The owner saw both test entries in the app's buddy list and on the dive** ("1 Tauchgänge zusammen" each), but only
   after a while: the app syncs its buddy list less often than its dives (12 h against 1 h, from its code [R]). Until it
   has synced, a dive with a new entry shows no buddy in the app.
   The app's list labels some entries "Freunde": **`confirmed: 1` means the person has the account in their own list too**
   (owner; the four entries in the owner's screenshot match the flag) [T].
6. **`buddy account`**: the e-mail entry sent again with `master_id` set to an existing buddy's account (a real buddy of the
   owner's, chosen by the owner): **SSI keeps the account on the same entry** and fills the entry from that person's SSI
   profile: their own spelling of the name, e-mail, photo, town, country, `forename`, and `confirmed: 1`. The existing
   entry of that person was unchanged. **SSI does not merge by account:** two entries with one account stood in the list.
   So an entry added from scratch can be linked to an account later, a wrong account shows as another person's name in
   the answer, and avoiding duplicates is the client's job.
7. **`buddy finish`**: the test dive deleted. Sending the linked test entry with `master_id: 0` removed it from the list at
   once (before any delete was sent); the other entry sent with `deleted: 1` **stays in `get_buddies` with `deleted: 1`**
   (the app hides it; Dive Hub's client already skips such entries, and reads `buddy_master_id: 0` as no account).
   The owner's real entry stayed.

## Privacy flaws at SSI (owner, 2026-10-27)

**Second flaw** (step 6): an account number alone is enough to get a person's e-mail, photo and town: an entry saved with
it comes back filled from their profile, whether or not they know the saver. Together with the first flaw, a name alone
gives all of that. Dive Hub only ever sends an account it got from the person's buddy code or from the User's own list.

**First flaw** (step 2):

`search_buddy` names the SSI account of a person who has not allowed being found (step 2). Anyone signed in can type a name
and get an account number; with it, a buddy QR code can be made (plain text, no signature) and the person added without
being told. Only the number leaks, no name or e-mail; SSI says "this or a similar name", so it may pick one of several.

- **Dive Hub never uses a number from that text** (owner): it would go around the person's choice, can pick the wrong
  person, and is a leak SSI may close.
- **A report to SSI is parked** (owner): worth sending, but it tells SSI that the account calls the API directly (ADR 0024's
  risk). When it is sent: only the pattern, with the owner's own search as the example, no other person, no Dive Hub.

## Pending

- The owner's look in SSI's app after the clean-up: 8 entries, no test entry, the chosen buddy once.
- What a `search_buddy` result looks like for a person who allows being found [?] (needs such a person).

## The session's own slip

Step 6's output printed the profile values SSI filled in (the chosen buddy's e-mail and town) into the session's local
output; the script showed test entries in full and only masked the account. Fixed: an entry that carries an account is
shown by its key names only.
