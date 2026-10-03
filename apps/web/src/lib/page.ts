import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The browser tab's title for the current page, "Dive 42 – Dive Hub" (WCAG 2.4.2). Every page calls
 * this once with the text of its h1; e2e/accessibility.spec.ts checks each page's title.
 */
export function usePageTitle(title: string | undefined) {
  const { t } = useTranslation();
  const appName = t('common.appName');
  useEffect(() => {
    document.title = title ? `${title} – ${appName}` : appName;
  }, [title, appName]);
}

/**
 * After moving to another page (not on the first load, and not when only the query changes, such as
 * the logbook's Diver filter): scroll to the top and put focus on the new page's h1, so keyboard and
 * screen reader users start at the new content (WCAG 2.4.3). Pages load data first, so this waits
 * for the h1 to appear, for up to two seconds; then it falls back to <main>.
 */
export function useFocusOnNavigate(route: string) {
  const path = route.split('?')[0];
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scrollTo(0, 0);
    const started = performance.now();
    let frame = 0;
    const focus = () => {
      const heading = document.querySelector<HTMLElement>('#main h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      } else if (performance.now() - started < 2000) {
        frame = requestAnimationFrame(focus);
      } else {
        document.getElementById('main')?.focus({ preventScroll: true });
      }
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [path]);
}
