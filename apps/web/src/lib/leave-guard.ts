import { useCallback, useEffect, useRef } from 'react';

// Unsaved changes (UI review B3): while a form has them, leaving the page asks first. Covers
// closing or reloading the tab (beforeunload) and moving within the app (hash routes, checked in
// App's useRoute through mayLeave()).

let guard: (() => boolean) | null = null;

/** Leaving asks `ask` first, until the returned release; releasing never drops a guard a later form holds. */
export function holdLeave(ask: () => boolean): () => void {
  guard = ask;
  return () => { if (guard === ask) guard = null; };
}

/**
 * While `active`, leaving asks `question` first. Returns the release for a form that just saved: nothing is lost, so
 * moving on (e.g. to the saved item's page) needn't ask.
 */
export function useLeaveGuard(active: boolean, question: string): () => void {
  const release = useRef(() => {});
  useEffect(() => {
    if (!active) return;
    const releaseThis = holdLeave(() => confirm(question));
    release.current = releaseThis;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', onBeforeUnload);
    return () => {
      releaseThis();
      removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active, question]);
  return useCallback(() => release.current(), []);
}

/** False if a form has unsaved changes and the User chose to stay. */
export const mayLeave = () => (guard ? guard() : true);
