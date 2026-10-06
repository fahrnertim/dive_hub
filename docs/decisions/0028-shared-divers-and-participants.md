---
title: "ADR 0028: Divers seen by every User by name; Participants on Dives"
summary: Every User sees every Diver of the instance by name (nothing else) and can put any of them on a Dive as buddy, guide or instructor; external Divers (no managing User) are shared like Dive sites - anyone adds and renames them, their creator or an admin deletes unused ones; Participants are set as one list per Dive, with the Dive's version and a Revision. Buddy suggestions and Joint dives stay later. Amends 0016. Amended: a buddy who becomes a User claims their external Diver by connecting their account at a Provider; admins merge external Divers by hand.
status: accepted
date: 2026-10-05
---

# ADR 0028: Divers seen by every User by name; Participants on Dives

## Status
Accepted – 2026-10-05. Amends [ADR 0016](0016-recording-decisions-and-divers.md) (Divers are no longer private to
the Users who manage them; their names are seen by every User).

## Context
Buddies on Dives, sent to SSI ([ADR 0029](0029-push-requirements-and-buddies.md)), need Participants, which weren't
built. ADR 0016 kept Divers private to the Users who manage them and left sharing for later. With private Divers, two
Users who dive with Bob each keep their own "Bob", and a Diver's External ID (his SSI account), unique on the instance
([ADR 0024](0024-ssi-target-via-app-api.md)), clashes the moment the second one imports him, telling that User that
someone else has Bob.

The project owner decided on 2026-10-05: one Diver per person on the instance, seen by every User by name, like Dive
sites are shared ([ADR 0020](0020-dive-sites.md)); on a self-hosted instance (a family, a club) that is no issue.
Roles buddy, guide and instructor now. Buddy suggestions and Joint dives later.

## Decision

### Who sees what
- **Every User sees every Diver by name**, wherever a Diver is picked: its id, its name, whether the User manages it,
  and whether it is external. Nothing else: no Dives, Devices, Connections, External ID values or personal data.
  A Diver's Dives stay with the Users who manage it (and Visibility later).
- **External Divers** have no managing User: people Users dived with, such as buddies imported from SSI. They are
  shared like Dive sites:
  - any User creates one (`created_by` is kept) and renames one, with a Revision;
  - their creator or an admin deletes one, while no Dive lists it;
  - their history never names another User (as for sites).
- **Divers a User manages** (their own, a child's) keep ADR 0016's rules: only managing Users rename or delete them.
  Other Users see their name and may put them on a Dive.
- A Diver's **External IDs** (accounts at services, ADR 0024) can be set by hand
  (`PUT /api/divers/{id}/external-ids/{source}`): on an external Diver by any User, on a managed one by its Users.
  It is refused while a Connection of that Diver uses the account (connecting set it), and when another Diver has it
  (`diver_external_id_taken`, naming that Diver, so the client can offer to use it instead).

### Participants
- **Participant** `(Dive, Diver, role)`, roles `buddy`, `guide`, `instructor`; at most one role per Diver and Dive; a
  Dive's own Diver isn't its Participant. `student` and `team member` from the data model come when needed (a new
  enum value).
- A guide leads a dive, an instructor teaches on it. Whether a Dive was a training dive is the Dive's purpose, a later
  field, not a role.
- **Set as one list:** `PUT /api/dives/{id}/participants` with the Dive's `version` (409 `dive_changed`), one Revision
  (`participants`, from and to with names and roles), and the version goes up. Participants are part of the Dive, so a
  Provider's "outdated" follows them where it sends them.
- A Diver on any Dive (deleted ones included) can't be deleted: `diver_not_empty` for managed Divers, `diver_in_use`
  for external ones.

### Later
- **Buddy suggestions and Joint dives** (data model scenario 2): putting another User's Diver on a Dive raises nothing
  yet; Anna sees nothing of Tim's Dive. They come with Visibility.
- **Merging two Divers** (the same person twice, or "Bob" signing up): later, like merging sites.
- **Admins managing Divers** beyond deleting unused external ones.

## Amended: a buddy who becomes a User claims their external Diver (owner, 2026-10-06, slice 16)
Found when Samuel, imported as an external Diver from the owner's SSI buddy list and a buddy on 21 of the owner's Dives,
signed up and connected his own SSI account: it was refused (`provider_account_taken`), the account being the external
Diver's. Two Divers stood for one person, and "merging two Divers" was left for later.
- **Claim through the account:** connecting an account that an *external* Diver holds is no longer refused. Signing in
  proved the account is the User's; Dive Hub asks first (`provider_account_held`, naming the external Diver and how many
  Dives it is on), and connecting again with `claim` merges it into the Diver being connected. An account held by a
  Diver another User keeps stays refused (`provider_account_taken`). Whoever added the external Diver isn't asked: the
  account decides.
- **Admins merge by hand** (`POST /api/admin/divers/{id}/merge` with `into`): an external Diver into any Diver, for
  buddies without an account at a Provider.
- **Merging** (`src/divers/merge.ts`): the external Diver's places as a Participant move to the other Diver (not onto a
  Dive of that Diver, nor twice on one Dive: the role already there stays), its accounts move (refused when the other has
  another account at the same service), and it is deleted with `merged_into` set. A Revision `merge` on both. The Dives
  it was on keep their versions: what Providers get of them (the accounts) doesn't change.
- Nothing of the Dives a claimed Diver is on becomes visible to the claiming User; Buddy suggestions, Joint dives and
  Visibility stay for later.
- *Considered:* only an admin merging (the person would wait for an admin though their account already proves it),
  asking the User who added the buddy (the account decides; they see the change on their Dives), and keeping the
  external Diver and linking the two (two Divers for one person stay in every list).

## Considered options
- **Private Divers (ADR 0016 as it was):** each User their own "Bob"; duplicates per User, and the unique External ID
  clashes across Users and reveals that the other one exists.
- **Divers shared with all their data:** personal data (birth date, contacts, certifications) of people who never
  signed up would be in front of every User.
- **Guide shown as instructor on training dives:** loses the guide on a training dive, and who taught matters for
  signatures and certifications.
- **One route per Participant** (add, change, remove): three calls and three versions for one edit of the dive page.

## Consequences
- The data model's "external Divers managed only by the User who created them" changes: no one manages them.
- Every User sees the names of everyone anyone logged a dive with, including people who never signed up. The privacy
  texts say so; nothing else about them is shown. Two Divers with the same name look the same in a picker.
- `diver.created_by` and Revisions on Divers (`entity_type = 'diver'`) are new.
- The client contract gains the Participants and external Diver routes and their duties
  ([clients.md](../spec/clients.md)).
