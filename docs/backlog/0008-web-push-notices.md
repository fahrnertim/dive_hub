---
title: Notices in the browser while Dive Hub's tab is closed (Web Push)
summary: A browser notification for what waits for the User (a send that stopped, a new entry in "Needs your decision", a finished import), through a service worker and the Push API; needs its own decision on the channel, consent and settings before it is planned.
status: draft
risk: medium
date: 2026-10-27
---

# Notices in the browser while Dive Hub's tab is closed (Web Push)

From the owner's piece 6 session ([design](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md), "Piece 6,
settled 2026-10-27"). Not ready: it needs a decision (ADR) first. Piece 6 shows a send's state only on the Dive's page,
in the logbook and on the Connection.

## Goal
- The User can allow notifications once (asked only after a click, never on page load) and gets a system notification
  for what needs them while no tab is open: a Waiting push that stopped, a new entry in "Needs your decision", a
  Connection that needs a sign-in, perhaps a finished import.
- Which notices go out is a setting per User; each can be turned off.

## What it needs (none exists yet)
- A service worker and a web app manifest in `apps/web`.
- VAPID keys (secrets), stored push subscriptions per browser and User, a sender on the server (worker job).
- An entry in the [client contract](../spec/clients.md) for subscribing.

## Limits to weigh in the decision
- The browser must be running; desktop shows it when the browser next runs, Android usually even when Chrome is closed.
- iPhone: only for Dive Hub added to the Home Screen (iOS 16.4 or later), not in a Safari tab.
- A notice must not be the only place: it duplicates what the pages show, never replaces it (errors don't time out).

## Open
- Which notices, and whether e-mail is the better channel for some of them.
