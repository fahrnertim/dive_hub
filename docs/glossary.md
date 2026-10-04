---
title: Glossary
summary: Canonical domain language of Dive Hub. One term per concept; avoided synonyms listed.
status: living
date: 2026-10-04
---

# Dive Hub

A self-hosted hub where several people collect, consolidate and forward their
dive-related data. This glossary fixes the words we use for it.

_German_ is the word the German UI uses ([ADR 0014](decisions/0014-design-system-and-localization.md)).
For terms not yet on screen it is a proposal; settle it when the term first appears in the UI.

## People and accounts

**User**:
An account that can sign in to a Dive Hub instance. A User manages one or more Divers.
_Avoid_: Account, member, login
_German_: Benutzer

**Admin**:
A User who may invite people and manage Users of the instance. A role of a User, not a separate account. An admin sees no other User's Dives.
_Avoid_: Superuser, owner, root
_German_: Admin

**Invitation**:
An admin's offer to one e-mail address to become a User: a single-use link that expires. Accepting it creates the User and their own Diver.
_Avoid_: Invite code, sign-up link
_German_: Einladung

**Password reset link**:
A single-use link an admin creates for a User who forgot their password. Using it sets a new password and signs them out everywhere else.
_Avoid_: Recovery link, reset token
_German_: Link zum Zurücksetzen (des Passworts)

**Disabled**:
The state of a User who can't sign in. Their data stays, and an admin can enable them again. Deleting a User, by contrast, removes everything only they own.
_Avoid_: Banned, suspended, deactivated
_German_: deaktiviert

**Diver**:
A person who dives and whose dives, certifications and equipment can be recorded.
A Diver may be managed by a User (their own Diver, or someone they log for, such as a child) or exist without one.
_Avoid_: Person, profile, owner (in the UDDF sense)
_German_: Taucher

**Participant**:
A Diver listed on a Dive with a role, such as buddy, guide, instructor or student.
_Avoid_: Attendee, member
_German_: Teilnehmer

**Buddy**:
The role a Diver has on another Diver's Dive when they dived together. A role, not a kind of person.
_Avoid_: Partner, companion
_German_: Buddy

## Dives

**Dive**:
One Diver's logbook entry for one descent: what happened, with whom, where, with which gear, and their notes.
Each participant of the same descent has their own Dive.
_Avoid_: Log entry, activity, event
_German_: Tauchgang

**Joint dive**:
The link between the Dives of Divers who made the same descent together.
_Avoid_: Group dive, shared dive
_German_: gemeinsamer Tauchgang

**Recording**:
The data one device captured for one Dive: its samples and the device's own summary. A Dive can have several.
_Avoid_: Profile, dive computer log, track
_German_: Aufzeichnung

**Device**:
A piece of a Diver's equipment that records data, such as a dive computer or tank transmitter, identified by its serial number.
_Avoid_: Computer (alone), gadget, watch
_German_: Gerät

**Duplicate candidate**:
A Recording that might belong to more than one Dive, or doesn't clearly match one, and waits for the User to decide.
_Avoid_: Conflict, possible duplicate
_German_: Duplikat-Kandidat

**Primary recording**:
The one Recording of a Dive whose summary values the Dive shows, unless the Diver overrode a value by hand.
_Avoid_: Master, main log
_German_: primäre Aufzeichnung

**Override**:
A Dive value the Diver set by hand, which wins over the Primary recording's value.
_Avoid_: Edit, correction
_German_: manueller Wert

**Buddy suggestion**:
A proposal to a User that a Diver they manage was a Buddy on someone else's Dive; accepting it links or creates that Diver's own Dive in the Joint dive.
_Avoid_: Invitation, tag
_German_: Buddy-Vorschlag

**Visibility**:
Who besides the Diver's managing Users may see a Dive: only them, the participants of its Joint dive, or every User of the instance.
_Avoid_: Privacy, sharing level
_German_: Sichtbarkeit

**Signature**:
A confirmation of a Dive by another person (buddy, instructor, dive center), covering the Dive as it was when signed.
The signer may be a User or someone signing on the Diver's device.
_Avoid_: Stamp, validation, verification
_German_: Unterschrift

**Stale signature**:
A Signature on a Dive whose signed content was changed afterwards. It stays visible but no longer vouches for the current Dive.
_Avoid_: Invalid, revoked
_German_: veraltete Unterschrift

**Revision**:
A recorded change to a Dive or other logbook data: who or what changed which values, and when.
_Avoid_: Version, history entry, audit log
_German_: Änderung

**Trip**:
One Diver's journey that groups their Dives, such as a liveaboard week. Trips of several Divers can be linked as the same journey.
_Avoid_: Tour, vacation, expedition
_German_: Tauchreise

## Places

**Dive site**:
A place where dives happen, shared across the whole instance: every User can use and edit it, its creator or an admin can delete it while no Dive is there. A Site import can create it from a Source; its External IDs say where it comes from.
_Avoid_: Spot, location, divesite
_German_: Tauchplatz

**Merge (of Dive sites)**:
Folding a duplicate Dive site into another: the kept site keeps its values and fills its gaps from the merged one; Dives and External IDs move to it. The merged site is gone, and its links lead to the kept one. Any User can merge; it can't be undone.
_Avoid_: Combine, join, deduplicate, link
_German_: zusammenführen (Tauchplätze)

**Position**:
Where on Earth something is, as latitude and longitude (WGS84). A Recording has an entry position and an exit position from its Device; a Dive shows its Primary recording's. A Dive site has one shared position.
_Avoid_: Location, coordinates (alone), GPS
_German_: Position (Einstiegs-, Ausstiegsposition)

**Operator**:
A business that runs dives or trips, such as a dive center, shop or liveaboard, shared across the instance.
_Avoid_: Dive base, business, dive shop
_German_: Anbieter

## Data in and out

**Source**:
A system or format that data comes from: dive data from Garmin, Suunto or a UDDF file, or Dive site data from OpenStreetMap or Wikidata. SSI is a Source of site IDs. A Source's license, Attribution and link pattern are defined once in code.
_Avoid_: Provider, integration, inbound, origin
_German_: Quelle

**External ID**:
The identifier a Source gives a record, such as an OpenStreetMap object (`node/123`), a Wikidata item (`Q…`) or an SSI site ID. Unique per Source; a Dive site has at most one per Source. It either provides data (the site was created or filled from that Source: "From OpenStreetMap") or is only a reference ("Also in OpenStreetMap"). A site without data-providing IDs was made in this instance.
_Avoid_: Foreign key, remote ID, reference number
_German_: externe ID (on screen: "SSI-Tauchplatz-ID")

**Attribution**:
The credit a Source's license requires wherever its data is shown, such as "© OpenStreetMap contributors" with a link to OSM's copyright page.
_Avoid_: Credits, copyright notice, source note
_German_: Namensnennung

**Site import**:
An admin's run that fetches Dive sites from open Sources (OpenStreetMap, Wikidata) for a country, an area or everywhere, and creates, updates or links sites. It shows in the history of every site it changed. Not an Import, which is a User's dive data.
_Avoid_: Sync, seed, site Import
_German_: Tauchplatz-Import

**Target**:
An outside service that Dive Hub sends dives to, such as SSI or PADI.
_Avoid_: Destination, integration, outbound
_German_: Ziel

**Connection**:
One User's configured link to a Source or a Target.
_Avoid_: Account link, integration
_German_: Verbindung

**Original**:
A file or payload exactly as received from a Source, kept unchanged and belonging to one User.
An archive that only bundles files (such as a zip) is not an Original; the files inside it are.
_Avoid_: Raw file, upload, dump
_German_: Originaldatei

**Import**:
One ingestion of what a User delivered at once (one or more Originals, possibly unpacked from an archive), producing or updating Recordings and Dives.
_Avoid_: Sync, upload
_German_: Import

**Conflict**:
A Dive value that was changed in two places since their last common state, such as in the hub and at the Source, or in two clients. The value already in the hub stays until the User decides.
_Avoid_: Merge error, Duplicate candidate
_German_: Konflikt

**Push**:
One Dive sent to one Target, with what was sent, when, and what the Target answered.
_Avoid_: Export, sync, share, broadcast
_German_: Übertragung

**Export**:
A file Dive Hub produces on request (such as UDDF) for the User to take elsewhere.
_Avoid_: Push, download
_German_: Export
