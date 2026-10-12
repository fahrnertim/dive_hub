import { useSyncExternalStore } from 'react';

/** The phone layout's breakpoint: the same width as the bottom bar's media query in `ui/ui.css`. */
const NARROW = '(max-width: 40rem)';

const subscribe = (notify: () => void) => {
  const list = matchMedia(NARROW);
  list.addEventListener('change', notify);
  return () => list.removeEventListener('change', notify);
};

/** Whether the page is laid out for a phone. Only for a choice of *what* shows; spacing and sizes stay in CSS. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches, () => false);
}
