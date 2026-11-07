// The browser's live channel (ADR 0066): one EventSource per browser, chosen by a Web Lock, with hints fanned out to
// the other tabs over a BroadcastChannel. Hints only say what changed; every screen refetches through the normal API.
// A dropped channel (or a reconnect after a deploy) refetches what is on screen, so no state exists only in the stream.
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export const HINT_KINDS = ['dive', 'site', 'waitingPush', 'import', 'siteImport', 'pushRun', 'certification', 'connection'] as const;
export type HintKind = (typeof HINT_KINDS)[number];

export interface LiveHint {
  v: 1;
  kind: HintKind;
  id: string;
}

const kinds = new Set<string>(HINT_KINDS);

/** A form that loaded this Dive and is dirty must not have its query replaced (design: changed while editing). */
const pinnedDives = new Set<string>();
const changedListeners = new Map<string, Set<() => void>>();

/** Keeps a dirty Dive's own query out of hint invalidation; returns the release. */
export function pinDive(id: string): () => void {
  pinnedDives.add(id);
  return () => {
    pinnedDives.delete(id);
  };
}

/** Hears that a pinned Dive changed elsewhere (a hint or a reconnect resync). */
export function onDiveChanged(id: string, listener: () => void): () => void {
  const set = changedListeners.get(id) ?? new Set();
  set.add(listener);
  changedListeners.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) changedListeners.delete(id);
  };
}

const notifyChanged = (id: string) => {
  for (const listener of changedListeners.get(id) ?? []) listener();
};

const isPinnedDiveQuery = (key: readonly unknown[]) =>
  key.length === 2 && key[0] === 'dives' && typeof key[1] === 'string' && pinnedDives.has(key[1]);

/** Invalidate the Dive queries except a dirty form's own; the forms that changed are told instead. */
async function invalidateDives(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'dives' && !isPinnedDiveQuery(q.queryKey) });
}

async function applyHints(queryClient: QueryClient, hints: LiveHint[]): Promise<void> {
  const kindsSeen = new Set(hints.map((h) => h.kind));
  // A Dive hint names its Dive: its form stays pinned and hears the change, but the batch is one refetch, not one per
  // Dive (an import of a whole logbook names every one of them).
  for (const hint of hints) if (hint.kind === 'dive' && pinnedDives.has(hint.id)) notifyChanged(hint.id);
  if (kindsSeen.has('dive') || kindsSeen.has('waitingPush')) await invalidateDives(queryClient);
  if (kindsSeen.has('site')) await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['sites'] }),
    // A Dive's title and list row carry its site's name and position.
    invalidateDives(queryClient),
  ]);
  if (kindsSeen.has('import')) await queryClient.invalidateQueries({ queryKey: ['imports'] });
  if (kindsSeen.has('siteImport')) await queryClient.invalidateQueries({ queryKey: ['site-imports'] });
  if (kindsSeen.has('pushRun')) await queryClient.invalidateQueries({ queryKey: ['push-runs'] });
  if (kindsSeen.has('certification')) await queryClient.invalidateQueries({ queryKey: ['divers'] });
  if (kindsSeen.has('connection')) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['connections'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-conflicts'] }),
      queryClient.invalidateQueries({ queryKey: ['gone-dives'] }),
    ]);
  }
}

// The arrival treatment reads these after a hint batch or a resync (design: new rows arrive politely).
let generation = 0;
let hintedDives = new Set<string>();
const liveListeners = new Set<() => void>();

function bump(): void {
  generation += 1;
  for (const listener of liveListeners) listener();
}

/** How many hint batches/resyncs have landed; a page compares it with the one it last handled. */
export const liveGeneration = () => generation;
/** The Dive ids named by the hints since the last call (empty on a resync). */
export function takeHintedDives(): Set<string> {
  const taken = hintedDives;
  hintedDives = new Set();
  return taken;
}
/** Hears every hint batch and resync; for the logbook's arrival comparison. */
export function onLiveEvent(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

// How many streams are healthy, so a tab without a leader follows its leader's health.
let healthy = false;
const healthListeners = new Set<() => void>();

/** TanStack only re-reads a `refetchInterval` when an observer's options are set again (ADR 0066). */
let reschedulePolling: (() => void) | null = null;

export const liveHealthy = () => healthy;

function setHealthy(next: boolean): void {
  if (healthy === next) return;
  healthy = next;
  // `refetchInterval` reads this flag, but a timer scheduled before the stream opened would still fire once, and a
  // channel that drops would never get its polling back. Re-setting the observers makes them re-read their timers.
  reschedulePolling?.();
  for (const listener of healthListeners) listener();
}

/** Whether hints are flowing: a `refetchInterval` returns false while this is true and resumes when it drops. */
export function useLiveHealthy(): boolean {
  return useSyncExternalStore(
    (listener) => {
      healthListeners.add(listener);
      return () => healthListeners.delete(listener);
    },
    liveHealthy,
    () => false,
  );
}

type ChannelMessage =
  | { type: 'hint'; hints: LiveHint[] }
  | { type: 'resync' }
  | { type: 'health'; healthy: boolean }
  | { type: 'hello' };

const CHANNEL = 'divehub-live';
const LOCK = 'divehub-live';

/** Starts the live channel for a signed-in page. Safe to call more than once; does nothing without EventSource. */
export function startLive(queryClient: QueryClient): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => undefined;

  // Health reaches TanStack's timers only when an observer sets its options again; do that once per change.
  const reschedule = () => {
    for (const query of queryClient.getQueryCache().getAll()) {
      for (const observer of query.observers) observer.setOptions(observer.options);
    }
  };
  reschedulePolling = reschedule;

  let stopped = false;
  let source: EventSource | null = null;
  let opened = false;
  const broadcast: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  let leading = false;
  let pending: LiveHint[] = [];
  const lockLost = new AbortController();
  let flush: ReturnType<typeof setTimeout> | undefined;

  const flushHints = () => {
    flush = undefined;
    const hints = pending;
    pending = [];
    if (hints.length === 0) return;
    hintedDives = new Set([...hintedDives, ...hints.filter((h) => h.kind === 'dive').map((h) => h.id)]);
    bump();
    void applyHints(queryClient, hints);
  };

  const deliver = (hints: LiveHint[]) => {
    if (hints.length === 0) return;
    pending.push(...hints);
    // The design coalesces hints 250 ms apart into one refetch and one arrival batch.
    if (!flush) flush = setTimeout(flushHints, 250);
  };

  const resync = () => {
    // Every reconnect refetches what is on screen; a pinned dirty form hears that its Dive changed instead.
    for (const id of pinnedDives) notifyChanged(id);
    void queryClient.invalidateQueries({ refetchType: 'active', predicate: (q) => !isPinnedDiveQuery(q.queryKey) });
    hintBatch([]);
  };

  const hintBatch = (hints: LiveHint[]) => {
    if (hints.length === 0) {
      hintedDives = new Set();
      bump();
      return;
    }
    deliver(hints);
  };

  const announceToTabs = (message: ChannelMessage) => broadcast?.postMessage(message);

  const onHint = (hint: LiveHint) => {
    announceToTabs({ type: 'hint', hints: [hint] });
    deliver([hint]);
  };

  function openStream(isLeader: boolean): void {
    source = new EventSource('/api/live');
    source.addEventListener('hint', (event) => {
      const hint = parseHint((event as MessageEvent<string>).data);
      if (!hint) return;
      if (isLeader) onHint(hint);
      else deliver([hint]);
    });
    source.addEventListener('open', () => {
      const reconnect = opened;
      opened = true;
      setHealthy(true);
      if (isLeader) announceToTabs({ type: 'health', healthy: true });
      if (reconnect) {
        if (isLeader) announceToTabs({ type: 'resync' });
        resync();
      }
    });
    source.addEventListener('error', () => {
      setHealthy(false);
      if (isLeader) announceToTabs({ type: 'health', healthy: false });
    });
  }

  const onChannelMessage = (event: MessageEvent<ChannelMessage>) => {
    const message = event.data;
    if (message.type === 'hint') deliver(message.hints);
    else if (message.type === 'resync') resync();
    else if (message.type === 'health') setHealthy(message.healthy);
    else if (message.type === 'hello' && leading) announceToTabs({ type: 'health', healthy });
  };

  broadcast?.addEventListener('message', onChannelMessage);

  const leader = async (): Promise<void> => {
    if (stopped) return;
    leading = true;
    // Another tab held the stream before this one: what it heard while this tab was a follower may be stale, so the
    // first open here goes through the reconnect resync too.
    if (healthy) opened = true;
    openStream(true);
    announceToTabs({ type: 'health', healthy });
    // Hold the lock until this tab goes away; the next tab's request then runs and opens its own stream.
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      window.addEventListener('pagehide', done, { once: true });
      lockLost.signal.addEventListener('abort', done, { once: true });
    });
  };

  const hasLocks = typeof navigator !== 'undefined' && 'locks' in navigator && typeof BroadcastChannel !== 'undefined';
  if (hasLocks) {
    // Every tab asks; exactly one callback runs, and it holds the one stream.
    void navigator.locks.request(LOCK, { signal: lockLost.signal }, leader).catch(() => {
      // Locking failed (an insecure context, for instance): this tab keeps its own stream.
      if (!stopped) openStream(false);
    });
  } else {
    openStream(false);
  }
  // A tab that joins after the leader opened asks for its health (the leader's earlier broadcast is gone).
  const hello = setTimeout(() => broadcast?.postMessage({ type: 'hello' }), 250);

  return () => {
    stopped = true;
    clearTimeout(hello);
    lockLost.abort();
    if (flush) clearTimeout(flush);
    source?.close();
    broadcast?.close();
    setHealthy(false);
    if (reschedulePolling === reschedule) reschedulePolling = null;
  };
}

function parseHint(data: string): LiveHint | null {
  try {
    const value = JSON.parse(data) as Partial<LiveHint>;
    if (value.v !== 1 || typeof value.kind !== 'string' || !kinds.has(value.kind) || typeof value.id !== 'string') return null;
    return { v: 1, kind: value.kind as HintKind, id: value.id };
  } catch {
    return null;
  }
}

