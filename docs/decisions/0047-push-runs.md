---
title: "ADR 0047: Push runs, sending many Dives to a Provider in one action"
summary: A User sends the Dives the logbook's list shows to one Provider as a Push run - previewed from Dive Hub's data, run by the worker one Dive at a time with the adapter's own pause and ceiling (SSI 5 s, 100), updates only when chosen, Dives that can't go skipped and reported, stopped after two failures in a row, cancellable, continued after a restart.
status: proposed
date: 2026-10-09
---

# ADR 0047: Push runs, sending many Dives to a Provider in one action

## Status
Proposed – 2026-10-09. The owner answered the open questions the same day (marked "owner" below). Extends
[ADR 0027](0027-providers-as-adapters.md) (a new limit an adapter declares; "batch sending will go through the worker")
and builds on [ADR 0010](0010-graphile-worker-job-queue.md), [ADR 0029](0029-push-requirements-and-buddies.md) and
[ADR 0040](0040-logbook-rows-and-filters.md). To be built as slice 22b, before slice 23
([plan](../research/2026-10-09-push-runs.md#implementation-plan)).

## Context
- A Dive goes to a Provider from its own page, one at a time. A User with a logbook of some hundred Dives and a new
  SSI Connection opens each Dive. The logbook already counts them ("Not in SSI", ADR 0040) but offers nothing to do.
- A client can't queue single sends: a request waits at most 30 s for its Connection's turn, so more than about six
  SSI sends queued at once answer `provider_busy` (ADR 0027, amended). A browser tab that sends one after another
  stops when it is closed.
- SSI's app API is private and publishes no limits. What others do
  ([research](../research/2026-10-09-push-runs.md#how-ssi-and-others-send-many-dives)): no batch call is known; the
  community clients send one dive per call in sequence, oldest first, with no pause and no ceiling; no refusal of saves
  is reported, but SSI's app is refused a second logbook pull within a minute. So the limits here are our own caution,
  not SSI's rule.
- Requirements are checked against Dive Hub's data alone (ADR 0029), and whether a Dive is at a Provider and up to date
  is known from its Pushes. So what a bulk send would do can be said before anything is sent, without calling the Provider.

## Decision

### Words
- **Push run** (German *Sammelübertragung*): one User's request to send many Dives of one Diver to one Provider. It
  belongs to a Connection, has one item per Dive it will send, and makes an ordinary Push per Dive. On screen it is
  "Send dives to SSI", not the word.
- Not a Push run: importing from a Provider (an Import, ADR 0030) and deleting many Dives there. Neither is designed here.

### Which Dives (owner: the logbook's list)
- A Push run covers **the Dives the logbook's list shows** for the Connection's Diver: the list's `siteId`, `q` and
  `only`, as `GET /api/dives` takes them. "Everything not at SSI" is the list with that chip pressed.
- The API also takes **a list of Dive ids** (at most 500) instead, for clients that select differently. The web client
  has no checkboxes on rows.
- Only Dives of the Connection's Diver that the User manages and that aren't deleted count. An id that is none of these
  is left out and counted (`notFound`), without saying which.
- One run is for one Connection. A list over several Divers offers one run per Connection.

### What is sent (owner: updates opt-in; skip and report)
Each Dive in scope is one of these, from Dive Hub's data alone (the same checks as the Dive's status, ADR 0027, 0029, 0043):

| Dive | In the run |
|---|---|
| not at the Provider, no blocking requirement unmet | sent (`create`) |
| at the Provider, changed since sent | only with `updates: true` (default false) |
| the same, and the update would remove a verification there (`updateRemovesVerification`) | only with `updatesRemovingVerification: true` as well (default false) |
| at the Provider and up to date | left out |
| a blocking requirement unmet | left out, listed with what is unmet |

- An advisory requirement doesn't hold a Dive back; its Push records who was left out, as for a single send.
- An update overwrites what Dive Hub sends, as a single update does. A change made at the Provider and not yet imported
  is not detected (it never was on sending; the import's three-way comparison is where Conflicts are found, ADR 0030).
  The dialog says so beside the tick.
- **A dive at the same time already at the Provider** that Dive Hub didn't send (`exists`) is only found when the
  Provider is asked. The run skips the Dive with the reason `exists` and never links or creates a second one by itself;
  the User decides on the Dive's page, as today.
- **Oldest first** (by start time). SSI's adapter numbers a new dive "highest in the logbook plus one" and never
  sends Dive Hub's number, so the order of sending is the numbering, and oldest first numbers the new dives in the
  order they were dived. The order is the run's own matter, not a promise of the API: clients read `position`, and a
  later change may order differently (owner's question, 2026-10-09, see "Renumbering" below).
- **The ceiling** cuts after the oldest Dives; the preview says how many are beyond it. The next run takes them.

### Limits an adapter declares (owner: SSI 5 s and 100)
`limits.run: { pauseMs, maxDives } | null` beside `limits.pauseMs`:
- `null`: the Provider takes no Push runs. A Provider whose delivery is `handed_over` must declare `null` (it can't
  tell what it already has, so a second run would send everything again).
- **SSI: `{ pauseMs: 5000, maxDives: 100 }`**: about 12 minutes for a full run. Raising either is a change to the
  adapter and a line in the [SSI reference](../references/ssi-app-api.md).
- The pause is the time from the end of one of the run's Dives to the start of the next. It is at least the
  Connection's own pause (2 s for SSI), which still holds between any two actions; a single send from a Dive's page
  takes its turn between two Dives of a run.
- One action at a time per Connection and per Dive, by the leases, as before. **One active Push run per Connection.**

### Where it runs
In the worker (ADR 0010), **one job per Dive**: a step sends the next waiting Dive through the same `send` a single
send uses, saves the item's result, and queues the next step to run after the pause. So no job sleeps, a run of twelve
minutes doesn't hold one of the worker's two slots, and other jobs (Imports) run between its Dives.
- **A restart continues the run:** the queued step is in PostgreSQL. At worker start every active run gets its step
  queued again, and an item left "sending" by a crash is waiting again. A dive whose answer was lost is found by our
  reference and linked, not created twice (Providers with `find`; without it a second copy is possible, as for a single
  send today).
- **This is the first time the worker calls a Provider.** It stays what the User asked for: a run starts only by their
  request, never on a schedule.

### What stops a run, and what doesn't
| What happens on a Dive | The item | The run |
|---|---|---|
| sent, updated, or linked to our own dive found there | `sent`, with its Push | goes on |
| `exists`; a blocking requirement unmet by now; up to date by now; an update not chosen by now; the Dive deleted | `skipped`, with the reason | goes on |
| the Connection or the Dive is busy (`provider_busy`) | waits, tried again later, three times in all | goes on |
| refused, not answering, an answer we can't read, the dive gone there | `failed`, with the problem code | goes on; **the second such failure in a row stops it** |
| sign-in needed, wrong credentials, not connected | waits | **stops at once** |

- A stopped run says why (`stopCode`) and keeps what it sent. **Continue** takes it up again: the failed items of
  the kinds in the fourth row are tried once more, then the waiting ones.
- **Cancel** is asked for at any time; the Dive being sent is finished, the rest stay unsent.
- A failed or skipped Dive has its Push (if one was made) and shows on its own page as it would after a single send.

### Progress and result
- The run is the record: its state (`queued`, `running`, `done`, `cancelled`, `stopped`), counts, and per Dive the
  state, outcome and reason. Clients poll it; there is no push channel.
- **Kept:** the last five runs of a Connection; an older one is deleted when a new one starts. They go with the
  Connection and the User. A run holds no data of the Provider beyond what its Pushes hold.

### API
| Route | Does |
|---|---|
| `POST /api/connections/{id}/push-runs/preview` | what a run would do: counts per row of the table above, how many would be sent, how many are beyond the ceiling, the Dives a blocking requirement holds back (the first 100, with what is unmet), how many would go without a Participant, the limits and the time it takes. Stores nothing, calls no Provider |
| `POST /api/connections/{id}/push-runs` | starts it (202 with the run). The same body as the preview: `dives` (`{ list: { siteId?, q?, only? } }` or `{ ids: [...] }`), `updates`, `updatesRemovingVerification` |
| `GET /api/push-runs` | the User's runs, newest first, without items |
| `GET /api/push-runs/{id}` | one run with its items |
| `POST /api/push-runs/{id}/cancel` | asks it to stop |
| `POST /api/push-runs/{id}/continue` | takes up a stopped run (202) |

- New problem codes: `push_run_active` (one is queued or running on this Connection; the answer carries its `runId`),
  `push_run_nothing_to_send`, `push_run_not_found`, `push_run_not_active` (cancel), `push_run_not_stopped` (continue).
  A Provider without `limits.run` answers `provider_unsupported`; a Connection that needs signing in answers
  `provider_sign_in_needed` before anything is queued.
- `GET /api/providers` gains `limits.run`. Additive.
- **Starting twice** is safe by the one-active rule: the second start answers `push_run_active` with the first's id.
  No idempotency key.
- **MCP: unchanged.** The endpoint is read-only ([ADR 0035](0035-mcp-connector.md)); a tool that sends needs its own ADR.

### Clients
The duties go into the [client contract](../spec/clients.md) with the code (listed in the
[plan](../research/2026-10-09-push-runs.md#client-duties-for-clientsmd)). In short: preview before starting and say
what is left out and why; the two update choices unticked; the Provider's notices; a determinate progress that survives
leaving the page; a stop control; a result that names every Dive not sent with its reason and leads to it; a stopped
run's reason with the way to fix it and to continue; errors that don't time out.

## Considered options
- **The client queues single sends.** No server work, but it ends with the tab, and the 30 s wait refuses the seventh.
  Raising the wait would keep dozens of requests open for minutes.
- **One long job that sleeps between Dives.** Simpler to read, but it holds one of two worker slots for the whole run
  and a restart loses its place in the pause.
- **Checkboxes on logbook rows** (owner: not now). Rows are links, a page is 25 Dives, and selection across pages and
  on phones is its own piece of UI. The API's `ids` form leaves the way open.
- **Always updating changed Dives** (owner: opt-in). An update overwrites and can remove a dive centre's verification;
  a bulk action shouldn't do that unasked.
- **Linking an `exists` dive without asking.** Fewer leftovers, but two dives logged minutes apart would be tied wrongly,
  and a wrong link is hard to see afterwards.
- **Stopping at the first Dive that can't go.** One missing site ID would hold up everything behind it.
- **No pause, as the community clients do, or no ceiling.** Works for them as far as anyone reports, but nobody reports
  a large upload, the API is private, and the account at risk is the User's.
- **One logbook read for the whole run instead of a read-back per Dive.** Fewer calls of the kind SSI is known to
  throttle for its app, but no check of what SSI stored and no dive number from the Provider per Dive (ADR 0027). Kept
  as it is; the rule "two failures in a row stop the run" is what catches a throttle, and the first real runs show
  whether it is needed.
- **A resume instead of continue-by-starting-again.** Starting a new run over "Not in SSI" also continues, and stays
  possible. Continue is kept because a run started from a search or a list of ids has no such filter.

## Consequences
- A logbook goes to SSI in a few runs of 100, unattended, with a list of what needs the User.
- The worker calls Providers. "The worker never calls SSI" in the [SSI reference](../references/ssi-app-api.md) and
  the list of when Dive Hub calls SSI change with the code.
- Two new tables (`push_run`, `push_run_item`) and a task (`push_run_step`). A Push doesn't change.
- An adapter has one more thing to declare; the contract suite checks that `handed_over` goes with `run: null`.
- The preview examines every Dive in scope (several queries each). Fine at logbook scale; with
  [ADR 0017](0017-logbook-list-paging.md)'s threshold it needs a narrower query first.
- With several app processes, a crash can leave two chains of steps for one run for a while. An item is taken by one
  step only and the leases hold, so nothing is sent twice; the run is merely paced by the Connection's pause until one
  chain ends.
- SSI numbers a dive by the highest number plus one, so old Dives sent into a logbook that has newer ones get high
  numbers. That is today's behaviour for a single send; a run makes it more visible. Not changed here.
- **Renumbering is not designed** (owner's idea, 2026-10-09: optionally make the Provider's numbers follow Dive
  Hub's). It needs its own decision. What is known for it: with explicit numbers the order of creates decides nothing;
  the order matters when dives already there change their number, and only if the Provider refuses a number twice
  (then from the highest down when numbers move up, so each is free before it is taken, and from the lowest up when
  they move down). Whether SSI refuses a duplicate number is unchecked (an owner's check in the
  [SSI reference](../references/ssi-app-api.md#owners-checks-pending)). A run's items and the adapter's `limits.run`
  would carry such a pass unchanged.
- Not designed: bulk import from a Provider, bulk delete at a Provider, a run over several Providers at once, a
  schedule ("send new Dives by itself"), an MCP tool that sends.
