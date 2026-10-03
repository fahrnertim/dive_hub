// Where keyboard focus goes when the element that had it disappears (WCAG 2.4.3). Without this the
// browser drops focus to <body>, and a keyboard or screen reader user starts over at the top.

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type="hidden"]), select, textarea, [tabindex="0"]';

/** Focuses the first control inside `el`; false if there is none. */
export function focusFirstIn(el: Element | null | undefined): boolean {
  const target = el?.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus();
  return Boolean(target);
}

/** Focuses a heading as a starting point (not a control): the panel's own, else the page's h1. */
export function focusHeading(near?: Element | null) {
  const heading = near?.closest('section')?.querySelector<HTMLElement>('h1, h2') ?? document.querySelector<HTMLElement>('#main h1');
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

/**
 * After the item at `index` of `list` was removed: focus the item now in its place, else the one
 * before it, else the list's panel heading. Waits for React to render the shorter list (up to a
 * second, since the list comes back from the server first).
 */
export function refocusAfterRemoval(list: HTMLElement | null, index: number, before: number) {
  if (!list) return focusHeading();
  const started = performance.now();
  const attempt = () => {
    const items = list.isConnected ? [...list.children] : [];
    if (list.isConnected && items.length === before && performance.now() - started < 1000) {
      requestAnimationFrame(attempt);
      return;
    }
    if (!focusFirstIn(items[index]) && !focusFirstIn(items[index - 1])) focusHeading(list.isConnected ? list : null);
  };
  requestAnimationFrame(attempt);
}
