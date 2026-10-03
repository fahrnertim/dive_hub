/**
 * Tells screen reader users what just happened ("Dive saved", "Copied", "main.fit: new dive") through
 * one polite live region that is always in the page (WCAG 4.1.3). A region inserted together with
 * its text is often not read, which is why Notice doesn't rely on its own role=status.
 */
let region: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string) {
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.className = 'visually-hidden';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.dataset.announcer = 'true';
    document.body.append(region);
  }
  // Clear first, then set: the same message twice in a row is announced twice.
  region.textContent = '';
  clearTimeout(timer);
  const target = region;
  timer = setTimeout(() => { target.textContent = message; }, 50);
}
