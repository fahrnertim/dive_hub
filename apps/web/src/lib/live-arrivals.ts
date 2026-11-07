// "New rows arrive politely" (FAH-37 design decision): compare page 1 with its previous result after a background
// refresh, tint the rows that arrived when they first become visible, and offer a pill when they are out of sight. The
// list itself never moves; the viewport is put back where it was.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { announce } from './announce.ts';
import { focusHeading } from './focus.ts';
import { onLiveEvent, takeHintedDives } from './live.ts';

interface Page {
  dives: { id: string }[];
  total: number;
}

/** How long the arrival tint stays, fade included. */
const TINT_MS = 2_400;

export interface LiveArrivals {
  /** The rows to tint: the ones that arrived and have been at least half visible. */
  tinted: ReadonlySet<string>;
  /** The arrived rows the User has not seen yet, in the pill's count. */
  unseen: readonly string[];
  /** Scrolls to the first unseen row, focuses its link, and clears the pill. */
  show: () => void;
}

/**
 * `pageKey` identifies the query (a parameter change must not carry arrivals over); `enabled` is page 1 only.
 * `count` says the batch's size for the polite announcement ("3 new dives").
 */
export function useLiveArrivals({
  pageKey, enabled, data, isPlaceholderData, count,
}: {
  pageKey: string;
  enabled: boolean;
  data: Page | undefined;
  isPlaceholderData: boolean;
  count: (n: number) => string;
}): LiveArrivals {
  const previous = useRef<{ key: string; ids: Set<string>; total: number } | null>(null);
  const hinted = useRef(new Set<string>());
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const [tinted, setTinted] = useState<Set<string>>(new Set());
  const [unseen, setUnseen] = useState<Set<string>>(new Set());
  const anchor = useRef<{ id: string; top: number } | null>(null);

  // Every hint batch or reconnect resync names its Dives; a plain polling refresh has none and trusts the id/total compare.
  useEffect(() => onLiveEvent(() => {
    // The ids are consumed here; the hook's own data effect runs when the refetch lands.
    for (const id of takeHintedDives()) hinted.current.add(id);
  }), []);

  useEffect(() => {
    if (!enabled) {
      previous.current = null;
      setArrived(new Set());
      setUnseen(new Set());
      hinted.current = new Set();
      return;
    }
    if (!data || isPlaceholderData) return;
    const ids = new Set(data.dives.map((d) => d.id));
    const before = previous.current;
    previous.current = { key: pageKey, ids, total: data.total };
    if (!before || before.key !== pageKey) {
      // Another page, Diver, search, filter or sort: no highlight or pill crosses views.
      hinted.current = new Set();
      setArrived(new Set());
      setUnseen(new Set());
      anchor.current = null;
      return;
    }
    const grown = data.total > before.total;
    const fresh = [...ids].filter((id) => !before.ids.has(id));
    // A new Dive deleted before it was seen leaves the pill's count (design: deleted before seen).
    setUnseen((old) => {
      const next = new Set([...old].filter((id) => ids.has(id)));
      return next.size === old.size ? old : next;
    });
    const hintedIds = hinted.current;
    hinted.current = new Set();
    if (!grown || fresh.length === 0) return;
    // When hints named the arrivals, only those are new rows; a row that merely crossed the page boundary is not.
    const arrivals = hintedIds.size > 0 ? fresh.filter((id) => hintedIds.has(id)) : fresh;
    if (arrivals.length === 0) return;
    setArrived((old) => new Set([...old, ...arrivals]));
    setUnseen((old) => new Set([...old, ...arrivals]));
    announce(count(arrivals.length));
  }, [data, isPlaceholderData, enabled, pageKey, count]);

  // Tint an arrived row the first time it is at least half visible, and drop it from the unseen count then.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const now = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.diveId).filter((id): id is string => !!id);
      if (now.length === 0) return;
      setTinted((old) => new Set([...old, ...now]));
      setUnseen((old) => {
        const next = new Set(old);
        for (const id of now) next.delete(id);
        return next;
      });
      for (const id of now) {
        window.setTimeout(() => {
          setTinted((old) => {
            const next = new Set(old);
            next.delete(id);
            return next;
          });
          setArrived((old) => {
            const next = new Set(old);
            next.delete(id);
            return next;
          });
        }, TINT_MS);
      }
    }, { threshold: 0.5 });
    for (const id of arrived) {
      const row = document.querySelector<HTMLElement>(`[data-dive-id="${CSS.escape(id)}"]`);
      if (row) observer.observe(row);
    }
    return () => observer.disconnect();
  }, [arrived]);

  // Keep the row the User is looking at where it was: a background refresh must not move the list under the cursor.
  useLayoutEffect(() => {
    const here = anchor.current;
    if (!here) return;
    const row = document.querySelector<HTMLElement>(`[data-dive-id="${CSS.escape(here.id)}"]`);
    if (!row) return;
    const delta = row.getBoundingClientRect().top - here.top;
    if (delta !== 0 && window.scrollY > 0) window.scrollBy(0, delta);
    anchor.current = { id: here.id, top: row.getBoundingClientRect().top };
  }, [data]);

  useEffect(() => {
    const remember = () => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-dive-id]')];
      if (rows.length === 0) return;
      const nearest = rows.reduce((best, row) => {
        const top = row.getBoundingClientRect().top;
        return Math.abs(top) < Math.abs(best.top) ? { id: row.dataset.diveId!, top } : best;
      }, { id: rows[0]!.dataset.diveId!, top: rows[0]!.getBoundingClientRect().top });
      anchor.current = nearest;
    };
    addEventListener('scroll', remember, { passive: true });
    remember();
    return () => removeEventListener('scroll', remember);
  }, [data]);

  const show = () => {
    if (unseen.size === 0) return;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-dive-id]')];
    const next = rows.find((row) => unseen.has(row.dataset.diveId ?? ''));
    if (!next) {
      setUnseen(new Set());
      // The rows went before the User got there: do not drop focus to <body>.
      focusHeading(document.querySelector('.dive-list'));
      return;
    }
    next.scrollIntoView({ block: 'start' });
    next.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    setUnseen(new Set());
  };

  return { tinted, unseen: [...unseen], show };
}
