---
title: Glossary
summary: Canonical domain language of Dive Hub. One term per concept; avoided synonyms listed.
status: living
date: 2026-10-06
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
Every User sees every Diver of the instance by name, and nothing else of Divers they don't manage ([ADR 0028](decisions/0028-shared-divers-and-participants.md)).
_Avoid_: Person, profile, owner (in the UDDF sense)
_German_: Taucher

**External diver**:
A Diver no User manages: someone Users dived with, such as a buddy taken from an SSI buddy list. Shared like a Dive site: any User adds and renames one; whoever added it, or an admin, deletes it while no Dive lists it. When its person becomes a User, they claim it by connecting the account it holds (or an admin merges it): it merges into their own Diver ([ADR 0028](decisions/0028-shared-divers-and-participants.md)).
_Avoid_: Contact, guest, buddy (that is a role)
_German_: anderer Taucher

**Participant**:
A Diver listed on someone else's Dive with a role: buddy, guide (led the dive) or instructor (taught on it). Student and team member come when needed. Whether a Dive was a training dive is the Dive's purpose, not a role.
_Avoid_: Attendee, member
_German_: Teilnehmer

**Buddy**:
The role a Diver has on another Diver's Dive when they dived together. A role, not a kind of person.
_Avoid_: Partner, companion
_German_: Buddy

**AI access**:
A User's permission for one LLM client (Claude Code, an editor) to read their logbook through Dive Hub's MCP endpoint, with a name, what it may read (the logbook, optionally the Dives' positions) and a key shown once (later OAuth). It sees what its User sees, can only read, can be revoked, and works only while an admin has switched AI access on ([ADR 0035](decisions/0035-mcp-connector.md)).
_Avoid_: Connection (that is a Provider's), integration, API key (that is how it signs in; on screen "key"), token, MCP client
_German_: KI-Zugang (its key: "Schlüssel")

**AI access log**:
The record of what a User's AI accesses read: when, which access, which request (the tool and its arguments, without search words), how many results, and whether it was answered. Shown to its User for 90 days, for revoked accesses too.
_Avoid_: Audit trail, history (that is Revisions)
_German_: on screen "Was gelesen wurde"

## Dives

**Dive**:
One Diver's logbook entry for one descent: what happened, with whom, where, with which gear, and their notes.
Each participant of the same descent has their own Dive. A Dive made from a Provider's Logbook entry has no Recording
until the dive computer's file comes in ([ADR 0030](decisions/0030-importing-dives-from-providers.md)).
_Avoid_: Log entry, activity, event
_German_: Tauchgang

**Deleted dive**:
A Dive the User deleted. It counts nowhere and isn't imported again, but it is kept and can be restored with its Recordings ([ADR 0026](decisions/0026-deleting-dives.md)).
_Avoid_: Trash, archived dive, removed dive
_German_: gelöschter Tauchgang

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

**Logbook check**:
Something in a logbook that can't be right as it stands, found by fixed rules: a Dive without a Recording overlapping a Dive with one, or two Dives of one Diver overlapping in time; and, about one Dive, a Recording so short and shallow that it is probably no dive (to delete or to keep). It waits in "Needs your decision" with ways to resolve it (merge, two dives, correct a time, move to another Diver, delete); nothing is merged unasked ([ADR 0038](decisions/0038-logbook-checks-and-merging-dives.md)).
_Avoid_: Duplicate candidate (a Recording waiting for its Dive), Finding, Conflict, housekeeping (in the UI)
_German_: Logbuch-Prüfung (on screen: "Etwas aufzuräumen")

**Merge (of Dives)**:
Folding one Dive into another that is the same descent: the kept Dive (the one with the Recording) fills its gaps from the other and takes its link to a Provider; the other is deleted like any Dive and names the kept one ([ADR 0038](decisions/0038-logbook-checks-and-merging-dives.md)).
_Avoid_: Combine, deduplicate, attach (that is a Recording's)
_German_: zusammenführen (Tauchgänge)

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

## Gear and planning (planned)

Planned in [ADR 0031](decisions/0031-lead-suit-cylinders-and-lead-estimate.md) and [ADR 0032](decisions/0032-mod-and-no-decompression-limits.md) and [ADR 0033](decisions/0033-gas-plans-rules-and-groups.md); not built yet.

**Lead**:
The ballast a Diver carried on a Dive: one or more amounts with where they sat (belt, integrated, trim, ankle, backplate), and their total. No lead logged means unknown; 0 means none was carried.
_Avoid_: Weight (alone; that is the body's), ballast, weights
_German_: Blei

**Weighting feedback**:
How the lead felt on a Dive: right, too heavy or too light, optionally by how much. What lets the lead estimate learn what was needed, not only what was carried.
_Avoid_: Rating, buoyancy rating
_German_: Gefühl mit dem Blei (on screen: "Wie passte das Blei?")

**Exposure suit**:
What a Diver wore against the cold on a Dive: none, skin, wetsuit, semi-dry or drysuit, with its thickness, a hood, and a drysuit's undergarment. A Dive value, not (yet) an Equipment item.
_Avoid_: Suit (alone in the code), wetsuit (that is one type), protection
_German_: Tauchanzug

**Cylinder**:
A tank a Diver breathed from on a Dive: volume, working pressure, material (aluminium, steel, carbon), start and end pressure, gas. Picked from a catalogue of common cylinders (AL80, steel 12 L, …) or typed.
_Avoid_: Tank (in the code and docs; fine in English UI text), bottle
_German_: Flasche

**Body weight**:
A Diver's weight on a date, seen only by the Users who manage the Diver. Used by the lead estimate's rule of thumb.
_Avoid_: Weight (alone), mass
_German_: Körpergewicht

**Lead estimate**:
A suggestion, computed on request and never stored, of how much lead a Diver should carry in planned conditions: from their own Dives with the same exposure suit, adjusted for the cylinder and the water, else a rule of thumb; always with a range and its reasons, and never a substitute for a weight check.
_Avoid_: Weight calculator (the tool's name on screen may say so), recommendation, prediction
_German_: Blei-Schätzung (the tool: "Bleirechner")

**Gas mix**:
What a Diver breathes, as fractions of oxygen and helium (the rest nitrogen): air, nitrox (more oxygen), trimix (with helium). A Cylinder holds one; a Recording lists those its computer knew.
_Avoid_: Gas (alone, where the mix is meant), blend, EANx (fine in UI text: "EAN32")
_German_: Gasgemisch

**MOD**:
Maximum operating depth: the deepest a gas mix may be breathed at a chosen ppO2 limit (1.4 working, 1.6 contingency), in the water and at the altitude planned ([ADR 0032](decisions/0032-mod-and-no-decompression-limits.md)).
_Avoid_: Max depth (that is the Dive's deepest point)
_German_: MOD (maximale Einsatztiefe)

**No-decompression limit (NDL)**:
How long a diver may stay at a depth and still ascend directly, without decompression stops, by a decompression model (Bühlmann ZHL-16C) and gradient factors. Dive Hub computes it for clean tissues, air and nitrox, to 40 m; a dive computer also shows its own, in the Recording's samples.
_Avoid_: No-deco time, no-stop time, bottom time (that is wider)
_German_: Nullzeit

**Gradient factors (GF)**:
A diver's conservatism setting for a Bühlmann model, low and high, in percent (e.g. 40/85); for a no-stop dive only the high one matters. Dive computers record theirs on each Recording.
_Avoid_: Conservatism (alone), safety level
_German_: Gradientenfaktoren

**Oxygen exposure**:
The share of the oxygen limit a dive uses (CNS %, NOAA's table) and the longer-term dose (OTU). Can limit a nitrox dive before the NDL does.
_Avoid_: Oxygen toxicity (that is the harm), O2 clock
_German_: Sauerstoffbelastung

**SAC**:
A diver's gas consumption at the surface in litres per minute; at depth it multiplies by the ambient pressure. Dive Hub computes it per Dive from its Cylinder's pressures (or a tank pod), plans with a high percentile of recent Dives, or takes it as typed ([ADR 0033](decisions/0033-gas-plans-rules-and-groups.md)).
_Avoid_: RMV (fine as a synonym in UI text), air consumption, breathing rate
_German_: Atemminutenvolumen (AMV)

**Bottom time**:
How long a planned dive may stay at its depth: the shortest of the no-decompression limit, the oxygen limit and the gas above the reserve, said with which one binds. An estimate on the Tools page, never a substitute for the dive computer.
_Avoid_: Dive time, NDL (one of its limits), runtime
_German_: Grundzeit

**Gas plan**:
How much gas a planned dive uses, for one Diver or a group: per Diver and segment the litres and pressures, and where the dive turns and ascends by a gas rule. Computed on the Tools page, never stored ([ADR 0033](decisions/0033-gas-plans-rules-and-groups.md)).
_Avoid_: Air plan, gas calculation, consumption plan
_German_: Gasplanung

**Gas rule**:
A rule that says how much of the gas may be used before turning or ascending: a fixed reserve, a fixed ascent pressure, halves, thirds, sixths, or rock bottom.
_Avoid_: Reserve rule, air rule
_German_: Gasregel (on screen: "Drittelregel", "Halbe-Regel")

**Rock bottom**:
The gas two divers need to reach the surface together on one supply from the worst point of a dive, with stress and time to solve the problem. The pressure where the ascent must start, at the latest.
_Avoid_: Minimum gas (fine in UI text), reserve (that is fixed)
_German_: Mindestgas (Rock Bottom)

**Turn pressure**:
The pressure at which a dive that comes back the way it went heads back (halves, thirds, sixths).
_Avoid_: Return pressure, half-tank
_German_: Umkehrdruck

**Ascent pressure**:
The pressure at which a Diver must start the ascent: rock bottom, never below the reserve, or a fixed value a briefing sets ("up at 100 bar").
_Avoid_: Turn pressure (that is horizontal), reserve
_German_: Aufstiegsdruck

**Controlling diver**:
In a group's gas plan, the Diver who reaches a turn or ascent pressure first and so decides when the group turns or ascends.
_Avoid_: Worst diver, weakest link, limiting diver
_German_: bestimmender Taucher

**Tools**:
The page for planning aids such as the lead estimate; the later home of a dive planner that combines them around a planned dive.
_Avoid_: Planner (until it plans a dive), utilities
_German_: Werkzeuge

**Equipment item** (planned):
A piece of a Diver's gear, such as a regulator set, a BCD, a cylinder or a dive computer, with maker, model, serial and status (in use, retired, lost, sold). A Device has one. Either on every Dive of its Diver while in use (unless taken off a Dive) or only on the Dives it was put on ([ADR 0034](decisions/0034-equipment-items-and-service-schedules.md)).
_Avoid_: Gear item (fine in UI text), asset, kit (that is a set)
_German_: Ausrüstungsgegenstand (on screen: "Ausrüstung")

**Service schedule** (planned):
A rule for one kind of service on an Equipment item, set up by the User: every so many months, dives and/or dive hours, due at whichever comes first, counted from the last service of that kind. An item can have several (a cylinder's visual inspection and its pressure test).
_Avoid_: Service interval (the number inside it), reminder, maintenance plan
_German_: Wartungsplan (on screen: "Wartung alle …")

**Service record** (planned):
What was done to an Equipment item, when and by whom (optionally at what cost), and which service schedules it resets.
_Avoid_: Service log, maintenance entry, inspection (that is one kind)
_German_: Wartungseintrag

**Dive assessment**:
Dive Hub's look at a logged Dive: findings computed from its Primary recording's profile and the Diver's other dives by fixed, versioned rules, each with its source and how strong the evidence is. Not a score, not medical advice, and no verdict on how safe a dive was ([ADR 0036](decisions/0036-dive-assessment.md)).
_Avoid_: Dive score, rating (that is the Diver's), analysis (alone), review
_German_: Tauchgangsauswertung (on screen: "Auswertung")

**Finding**:
One thing the dive assessment noticed on a Dive, such as a short safety stop or a fast ascent: what was measured, the guidance it is held against with its source and evidence, a recommendation, and the stretch of the profile. At most one per rule and Dive, as information, a note or a caution. The User can put it aside on that Dive (dismiss) or stop its rule being shown for a Diver (mute; listed with the Diver); what was computed stays. DAN's no-fly time is shown beside the findings and is not one.
_Avoid_: Error, violation, warning (that is the computer's), issue
_German_: Hinweis

**Computer event**:
What a dive computer itself noted during a dive, such as "ascent too fast" or "safety stop left early" (Garmin's dive alerts, Suunto's alarms and warnings), in Dive Hub's words. Shown beside the findings, never merged with them: computers judge differently, the rules the same for every source.
_Avoid_: Alarm, warning (alone), finding
_German_: on screen "Dein Computer hat vermerkt"

## Places

**Dive site**:
A place where dives happen, shared across the whole instance: every User can use and edit it, its creator or an admin can delete it while no Dive is there. A Site import can create it from a Source; its External IDs say where it comes from.
_Avoid_: Spot, location, divesite
_German_: Tauchplatz

**Dive centre**:
A business that runs dives, shared across the whole instance like a Dive site: every User can use and edit it. It is responsible for the Dive sites it is linked to, and a Dive counts as belonging to the centres of its site. Its name is the whole name as its Source spells it (SSI: with the town after a comma); its display name is the shorter one shown, made by that Source's rule. With its SSI centre number it has an SSI verification code, the QR code a diver scans in SSI's app so that SSI shows a dive as verified ([ADR 0043](decisions/0043-dive-centres-and-ssi-verification-codes.md)).
_Avoid_: Dive center, dive shop, dive base, operator
_German_: Tauchcenter

**Water type (of a Dive site)**:
The water at a Dive site: fresh, salt or brackish. It is the water type of every Dive there; a Dive without a site has none. Any User sets it on the site; an SSI site import fills it. Not the computer's water setting.
_Avoid_: Salinity, water (alone), body of water (that is the lake or sea's name)
_German_: Wasserart

**Water setting (of a computer)**:
The water a dive computer was set to (fresh, salt, EN 13319 or a custom density), which it computes depths with. Part of a Recording's device data. When it differs from the site's water type, the dive page says so and how far the depths read off.
_Avoid_: Water type (that is the site's), salinity
_German_: Wassereinstellung am Computer

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
A system or format that data comes from: dive data from Garmin, Suunto (the Suunto app's JSON and FIT exports) or a UDDF file, or Dive site data from OpenStreetMap, Wikidata or SSI. SSI is also a Source of site IDs typed in by Users, and of account IDs on Divers. A Source's license, Attribution and link pattern are defined once in code. A Provider is a Source for the kinds of data it imports.
_Avoid_: integration, inbound, origin
_German_: Quelle

**External ID**:
The identifier a Source gives a record, such as an OpenStreetMap object (`node/123`), a Wikidata item (`Q…`), an SSI site ID, or a Diver's account at a service (SSI account ID). Unique per Source; a Dive site or a Diver has at most one per Source. Certification and membership numbers are not External IDs. It either provides data (the site was created or filled from that Source: "From OpenStreetMap", "From SSI") or is only a reference ("Also in OpenStreetMap"). A site without data-providing IDs was made in this instance.
_Avoid_: Foreign key, remote ID, reference number
_German_: externe ID (on screen: "SSI-Tauchplatz-ID")

**Attribution**:
The credit a Source's license requires wherever its data is shown, such as "© OpenStreetMap contributors" with a link to OSM's copyright page.
_Avoid_: Credits, copyright notice, source note
_German_: Namensnennung

**Offer (of a Source's data)**:
The values a Site import found for a hand-made Dive site, kept beside its reference instead of changing the site. Any User can take it ("Use SSI's data"): empty fields take the Source's values, filled ones stay, and the reference then provides data. Taking it is called adopting in the code and history.
_Avoid_: Suggestion, proposal, sync
_German_: Daten übernehmen (the action)

**Site import**:
An admin's run that fetches Dive sites from OpenStreetMap, Wikidata or SSI for a country, an area or everywhere, and creates, updates or links sites, or only fills sites already here. Hand-made sites are never changed; they get an Offer. SSI's list has no licence, so the admin confirms an explanation first. It shows in the history of every site it changed. Not an Import, which is a User's dive data.
_Avoid_: Sync, seed, site Import
_German_: Tauchplatz-Import

**Provider**:
An outside service Dive Hub talks to on a User's behalf, such as SSI and later PADI. It says what it offers: how Users sign in, which kinds of data (dives, Dive sites, buddies) it imports or exports, what it can do with them (create, update, delete, link, find), and whether it gives an ID back. It is a Source for what it imports and a Target for what it exports. Files and open datasets (a FIT file, OpenStreetMap) are Sources, not Providers.
_Avoid_: Integration, connector, plugin, service (in the code)
_German_: Dienst

**Target**:
A Provider in its role of receiving data from Dive Hub, such as SSI taking dives.
_Avoid_: Destination, integration, outbound
_German_: Ziel

**Push requirement**:
What a Provider needs before it takes a Dive, such as the Dive site's SSI site ID or a way to tell who each Participant is there. Checked against Dive Hub's own data only. *Blocking*: sending waits until it is met. *Advisory*: the Dive is sent without it, and the Push says who was left out ([ADR 0029](decisions/0029-push-requirements-and-buddies.md)).
_Avoid_: Precondition, validation, prerequisite
_German_: Voraussetzung (on screen: "SSI braucht zuerst …")

**Connection Diver mapping**:
A link, within one Connection, from a Diver to a person's record in that account at the Provider, such as an entry in the User's SSI buddy list. Not built: SSI finds a buddy's entry by the Diver's SSI account; mappings come if an entry without an account turns up ([ADR 0029](decisions/0029-push-requirements-and-buddies.md)).
_Avoid_: Buddy link, contact mapping
_German_: Taucher-Zuordnung

**Connection**:
One User's link to a Provider for one of their Divers: the account there and what lets Dive Hub sign in for them, sealed. For SSI that is the e-mail, a sign-in that may expire, and the password only if the User chose "Keep me signed in". When the Provider no longer accepts it, the Connection asks the User to sign in again.
_Avoid_: Account link, integration
_German_: Verbindung

**Original**:
A file or payload exactly as received from a Source, kept unchanged and belonging to one User.
An archive that only bundles files (such as a zip) is not an Original; the files inside it are.
Two Originals can hold the same dive (Suunto's FIT and JSON): both are kept, and the Recording is read from the fuller one.
_Avoid_: Raw file, upload, dump
_German_: Originaldatei

**Import**:
One ingestion of what a User delivered at once (one or more Originals, possibly unpacked from an archive), producing or updating Recordings and Dives. An import from a Provider reads the account's dives and keeps one Original per dive ([ADR 0030](decisions/0030-importing-dives-from-providers.md)).

**Logbook entry (at a Provider)**:
A dive at a Provider that was typed in by hand: rough values, no profile, no dive computer. An import matches it to a Dive here by its local start time within the matching window and fills what that Dive lacks (site, Participants, notes), or makes a Dive without a Recording from it; what changes at the Provider later comes back unless it was changed here too. A dive the Provider got from a dive computer becomes a Recording instead, unless the User chose otherwise for that computer ([ADR 0030](decisions/0030-importing-dives-from-providers.md)).
_Avoid_: Manual dive, log entry (alone)
_German_: Logbucheintrag
_Avoid_: Sync, upload
_German_: Import

**Conflict**:
A Dive value that was changed in two places since their last common state, such as in the hub and at the Source, or in two clients. The value already in the hub stays until the User decides.
_Avoid_: Merge error, Duplicate candidate
_German_: Konflikt

**Push**:
One action on one Dive at one Provider (sent, updated, linked to a dive already there, deleted there), with what was sent, when, and what the Provider answered (such as SSI's dive ID). A Push is *confirmed* when the Provider accepted it and gave an ID back; that is not SSI's "confirmed" (a dive center's verification), which Dive Hub can't set. It is *handed over* when it was delivered without an ID back (a QR code), so it can't be updated or deleted there.
_Avoid_: Export, sync, share, broadcast
_German_: Übertragung

**Export**:
A file Dive Hub produces on request (such as UDDF) for the User to take elsewhere.
_Avoid_: Push, download
_German_: Export
