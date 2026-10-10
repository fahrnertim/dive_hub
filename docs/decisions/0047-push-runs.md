---
title: "ADR 0047: Push runs, sending many Dives to a Provider in one action"
summary: A User sends the Dives the logbook's list shows to one Provider as a Push run - previewed from Dive Hub's data, run by the worker one Dive at a time with the adapter's own pause and ceiling (SSI 5 s, 100), updates only when chosen, Dives that can't go skipped and reported, stopped after two failures in a row, cancellable, continued after a restart.
status: accepted
date: 2026-10-09
---

# ADR 0047: Push runs, sending many Dives to a Provider in one action

## Status
Accepted – 2026-10-10, built in slice 22c (see "As built" at the end). Proposed 2026-10-09. The owner answered the open questions the same day (marked "owner" below). Extends
[ADR 0027](0027-providers-as-adapters.md) (a new limit an adapter declares; "batch sending will go through the worker")
and builds on [ADR 0010](0010-graphile-worker-job-queue.md), [ADR 0029](0029-push-requirements-and-buddies.md) and
[ADR 0040](0040-logbook-rows-and-filters.md). To be built as slice 22c, after the dive numbers slice (22b, owner 2026-10-09) and before slice 23
([plan](../research/2026-10-09-push-runs.md#implementation-plan)).

**Amended 2026-10-09 by [ADR 0048](0048-dive-numbers.md)** (dive numbers): a run's creates carry Dive Hub's number
when the Connection follows numbers, a third choice sets the number of dives already there, and number changes go
first in an order that keeps each number free. The places are marked "ADR 0048" below.

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
| at the Provider, its number there differs (`current.number.differs` and `canSet`, ADR 0048) | its number is set only with `numbers: true` (default false) |
| the same, at a Provider where a number change can remove a verification (`current.number.removesVerification`) | only with `updatesRemovingVerification: true` as well |

- **Numbers (ADR 0048).** The two last rows exist only for a Connection that follows numbers at a Provider that sets
  them on an update; elsewhere `numbers` changes nothing. They are beside the rows above, not instead: a Dive that is
  updated in the run gets its number with that update (one save, and the update then needs
  `updatesRemovingVerification` where a number change can remove a verification); a Dive that is up to date, or whose
  update isn't chosen, gets an item with the action `number`, which changes only the number
  (`pushes.setNumber`). A dive the run creates carries the Dive's number without any choice, where it is free.

- An advisory requirement doesn't hold a Dive back; its Push records who was left out, as for a single send.
- An update overwrites what Dive Hub sends, as a single update does. A change made at the Provider and not yet imported
  is not detected (it never was on sending; the import's three-way comparison is where Conflicts are found, ADR 0030).
  The dialog says so beside the tick.
- **A dive at the same time already at the Provider** that Dive Hub didn't send (`exists`) is only found when the
  Provider is asked. The run skips the Dive with the reason `exists` and never links or creates a second one by itself;
  the User decides on the Dive's page, as today.
- **Order: number changes first, then oldest first** (ADR 0048).
  - Creates and updates go oldest first (by start time). Where the Connection doesn't follow numbers, SSI's adapter
    numbers a new dive "highest in the logbook plus one", so the order of sending is the numbering, and oldest first
    numbers the new dives in the order they were dived.
  - `number` items go before them, each when its number is free: worked out when the run is planned, from the
    numbers on the Pushes. An item is next when no other dive of the Connection that Dive Hub knows holds the number
    it wants (after the items before it); among those that could go, the highest wanted number first. So numbers
    moving up go from the highest down and numbers moving down from the lowest up, and the creates behind them find
    their numbers free.
  - Dives that only swap numbers among themselves can never be next: they are left out (`number_taken`) and go from
    their own pages. A number held by a dive only at the Provider is found when the item is sent: `skipped` with
    `number_taken`.
  - The order is the run's own matter, not a promise of the API: clients read `position`.
- **The ceiling** counts every item and cuts after the number changes that fit, then after the oldest Dives; the
  preview says how many are beyond it. The next run takes them. A logbook whose numbers all moved by one takes
  several runs before a create behind them goes with its own number; sent earlier, it is numbered "highest plus one"
  and shows "number differs".

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
| sent, updated, its number set, or linked to our own dive found there | `sent`, with its Push | goes on |
| `exists`; a blocking requirement unmet by now; up to date by now; an update not chosen by now; the Dive deleted; its number taken there or nothing to set by now (ADR 0048) | `skipped`, with the reason | goes on |
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
| `POST /api/connections/{id}/push-runs` | starts it (202 with the run). The same body as the preview: `dives` (`{ list: { siteId?, q?, only? } }` or `{ ids: [...] }`), `updates`, `updatesRemovingVerification`, `numbers` (ADR 0048) |
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
what is left out and why; the two update choices and the numbers choice unticked; the Provider's notices; a determinate progress that survives
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
- Where a Connection doesn't follow numbers, SSI numbers a dive by the highest number plus one, so old Dives sent
  into a logbook that has newer ones get high numbers. That is today's behaviour for a single send; a run makes it
  more visible.
- **Numbers are [ADR 0048](0048-dive-numbers.md)** (slice 22b, built before this one; owner, 2026-10-09): Dive Hub
  computes a Dive's number, and a Connection can make the Provider's numbers follow. What a run gains from it is
  marked "ADR 0048" above: creates carry the number, the choice `numbers` sets it on dives already there, number
  changes go first in an order that keeps each free, and Dive Hub never sends a number another dive there has, so the
  order doesn't depend on whether SSI would refuse one (still an owner's check, for the record). A run's item gains
  the action `number` and the run the column `numbers`; the adapter's `limits.run` carries it unchanged.
- Renumbering a long logbook at SSI takes as many saves as it has dives after the change: at 100 per run and about
  12 minutes each, a logbook of 500 that moved by one is five runs.
- Not designed: bulk import from a Provider, bulk delete at a Provider, a run over several Providers at once, a
  schedule ("send new Dives by itself"), an MCP tool that sends.

## As built (slice 22c, 2026-10-10)

Everything above was built as decided. What the code settled, and the few additions:

- **Tables and routes:** `push_run` and `push_run_item` (migration 0034, [data model](../spec/data-model.md)); the six routes and the duties of a
  client are in the [client contract](../spec/clients.md#sending-many-dives-to-a-provider-push-runs); the worker step is in the
  [architecture](../spec/architecture.md).
- **Additions to the preview:** `leftOut` (the same counts a started run keeps), and `blocked.dives` is the first 100 with `siteId` so a
  client groups them by site. The body of preview and start is the same.
- **Not ordered:** an update that also carries a number (the dive is changed and the number differs) is one save with the number in it, so it
  is not part of the number-changing order: a create running before it can take that number first (Dive Hub never sends a number another
  dive there holds). To renumber many dives, start a run with only `numbers` ticked.
- **Failures:** a Provider's `provider_busy` is retried behind the other work and is no failure; a Dive deleted while the run waits is
  skipped as `dive_not_found`; a run whose Provider is no longer on this instance stops with `provider_not_connected`.
- **Client:** the "Send to SSI…" button in the logbook's toolbar opens the dialog; the strip above the list shows progress, the result
  with what was not sent, or the stop with Continue. The e2e pause is 150 ms (the real one is 5 s).
