import { useSyncExternalStore } from 'react';

/** The phone layout's breakpoint (menus, the logbook's choices). */
const NARROW = '(max-width: 40rem)';
/** The sidebar's breakpoint: the same width as the shell's media queries in `ui/ui.css`; below it the bottom bar shows. */
const WIDE = '(min-width: 64rem)';

const subscribeTo = (query: string) => (notify: () => void) => {
  const list = matchMedia(query);
  list.addEventListener('change', notify);
  return () => list.removeEventListener('change', notify);
};
const subscribeNarrow = subscribeTo(NARROW);
const subscribeWide = subscribeTo(WIDE);

/** Whether the page is laid out for a phone. Only for a choice of *what* shows; spacing and sizes stay in CSS. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches, () => false);
}

/** Whether the shell is a sidebar beside the page (from 64rem). Like `useNarrow`, only for a choice of what shows. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => matchMedia(WIDE).matches, () => false);
}
