---
title: Glossary
summary: Canonical domain language of Dive Hub. One term per concept; avoided synonyms listed.
status: living
date: 2026-10-02
---

# Dive Hub

A self-hosted hub where several people collect, consolidate and forward their
dive-related data. This glossary fixes the words we use for it.

## People and accounts

**User**:
An account that can sign in to a Dive Hub instance. A User manages one or more Divers.
_Avoid_: Account, member, login

**Admin**:
A User who may invite people and manage Users of the instance. A role of a User, not a separate account. An admin sees no other User's Dives.
_Avoid_: Superuser, owner, root

**Invitation**:
An admin's offer to one e-mail address to become a User: a single-use link that expires. Accepting it creates the User and their own Diver.
_Avoid_: Invite code, sign-up link

**Diver**:
A person who dives and whose dives, certifications and equipment can be recorded.
A Diver may be managed by a User (their own Diver, or someone they log for, such as a child) or exist without one.
_Avoid_: Person, profile, owner (in the UDDF sense)

**Participant**:
A Diver listed on a Dive with a role, such as buddy, guide, instructor or student.
_Avoid_: Attendee, member

**Buddy**:
The role a Diver has on another Diver's Dive when they dived together. A role, not a kind of person.
_Avoid_: Partner, companion

## Dives

**Dive**:
One Diver's logbook entry for one descent: what happened, with whom, where, with which gear, and their notes.
Each participant of the same descent has their own Dive.
_Avoid_: Log entry, activity, event

**Joint dive**:
The link between the Dives of Divers who made the same descent together.
_Avoid_: Group dive, shared dive

**Recording**:
The data one device captured for one Dive: its samples and the device's own summary. A Dive can have several.
_Avoid_: Profile, dive computer log, track

**Device**:
A piece of a Diver's equipment that records data, such as a dive computer or tank transmitter, identified by its serial number.
_Avoid_: Computer (alone), gadget, watch

**Duplicate candidate**:
A Recording that might belong to more than one Dive, or doesn't clearly match one, and waits for the User to decide.
_Avoid_: Conflict, possible duplicate

**Primary recording**:
The one Recording of a Dive whose summary values the Dive shows, unless the Diver overrode a value by hand.
_Avoid_: Master, main log

**Override**:
A Dive value the Diver set by hand, which wins over the Primary recording's value.
_Avoid_: Edit, correction

**Buddy suggestion**:
A proposal to a User that a Diver they manage was a Buddy on someone else's Dive; accepting it links or creates that Diver's own Dive in the Joint dive.
_Avoid_: Invitation, tag

**Visibility**:
Who besides the Diver's managing Users may see a Dive: only them, the participants of its Joint dive, or every User of the instance.
_Avoid_: Privacy, sharing level

**Signature**:
A confirmation of a Dive by another person (buddy, instructor, dive center), covering the Dive as it was when signed.
The signer may be a User or someone signing on the Diver's device.
_Avoid_: Stamp, validation, verification

**Stale signature**:
A Signature on a Dive whose signed content was changed afterwards. It stays visible but no longer vouches for the current Dive.
_Avoid_: Invalid, revoked

**Revision**:
A recorded change to a Dive or other logbook data: who or what changed which values, and when.
_Avoid_: Version, history entry, audit log

**Trip**:
One Diver's journey that groups their Dives, such as a liveaboard week. Trips of several Divers can be linked as the same journey.
_Avoid_: Tour, vacation, expedition

## Places

**Dive site**:
A place where dives happen, shared across the whole instance.
_Avoid_: Spot, location, divesite

**Operator**:
A business that runs dives or trips, such as a dive center, shop or liveaboard, shared across the instance.
_Avoid_: Dive base, business, dive shop

## Data in and out

**Source**:
A system or format that dive data comes from, such as Garmin, Suunto or a UDDF file.
_Avoid_: Provider, integration, inbound

**Target**:
An outside service that Dive Hub sends dives to, such as SSI or PADI.
_Avoid_: Destination, integration, outbound

**Connection**:
One User's configured link to a Source or a Target.
_Avoid_: Account link, integration

**Original**:
A file or payload exactly as received from a Source, kept unchanged and belonging to one User.
An archive that only bundles files (such as a zip) is not an Original; the files inside it are.
_Avoid_: Raw file, upload, dump

**Import**:
One ingestion of what a User delivered at once (one or more Originals, possibly unpacked from an archive), producing or updating Recordings and Dives.
_Avoid_: Sync, upload

**Conflict**:
A Dive value that was changed in two places since their last common state, such as in the hub and at the Source, or in two clients. The value already in the hub stays until the User decides.
_Avoid_: Merge error, Duplicate candidate

**Push**:
One Dive sent to one Target, with what was sent, when, and what the Target answered.
_Avoid_: Export, sync, share, broadcast

**Export**:
A file Dive Hub produces on request (such as UDDF) for the User to take elsewhere.
_Avoid_: Push, download
