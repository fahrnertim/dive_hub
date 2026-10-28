// When an open page asks again about the queue of Waiting pushes (ADR 0056): at the time the earliest entry that waits
// is due, not every few seconds. Until live updates come (docs/backlog/0009), this is how the page follows the worker.

/** The longest timer the browser keeps (about 24.8 days); a later time is asked for at that point. */
const MAX_TIMER_MS = 2_147_483_647;
/** Past due, the worker sends within a minute or two: asked every 5 s for a minute, then every minute. */
const SOON_MS = 5_000;
const LATE_MS = 60_000;
/** After the due time, a little longer: the worker's job runs at it and needs a moment. */
const AFTER_DUE_MS = 2_000;

/**
 * How long until asking again about these entries (`refetchInterval`), or false when none waits: held and stopped
 * entries change only by the User's own action, which refreshes the page itself.
 */
export function pollUntilDue(entries: readonly { state: string; dueAt: string }[] | null | undefined, now: number): number | false {
  const due = (entries ?? []).filter((e) => e.state === 'waiting').map((e) => Date.parse(e.dueAt));
  if (due.length === 0) return false;
  const until = Math.min(...due) - now;
  if (until > 0) return Math.min(until + AFTER_DUE_MS, MAX_TIMER_MS);
  return -until < LATE_MS ? SOON_MS : LATE_MS;
}
