import { useEffect } from 'react';

// Unsaved changes (UI review B3): while a form has them, leaving the page asks first. Covers
// closing or reloading the tab (beforeunload) and moving within the app (hash routes, checked in
// App's useRoute through mayLeave()).

let guard: (() => boolean) | null = null;

/** While `active`, leaving asks `question` first. */
export function useLeaveGuard(active: boolean, question: string) {
  useEffect(() => {
    if (!active) return;
    const ask = () => confirm(question);
    guard = ask;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', onBeforeUnload);
    return () => {
      if (guard === ask) guard = null;
      removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active, question]);
}

/** A form that just saved: nothing is lost, so moving on (e.g. to the saved item's page) needn't ask. */
export const releaseLeaveGuard = () => { guard = null; };

/** False if a form has unsaved changes and the User chose to stay. */
export const mayLeave = () => (guard ? guard() : true);
