// Localization (ADR 0014): i18next starts when main.tsx asks, in the language it is given.
import { afterAll, describe, expect, it, vi } from 'vitest';

describe('initI18n', () => {
  afterAll(() => { vi.unstubAllGlobals(); });

  it('does nothing on import, then starts in the given language and keeps <html lang> in step', async () => {
    const module = await import('../src/i18n/index.ts'); // throws if importing touches document
    const root = { lang: '' };
    vi.stubGlobal('document', { documentElement: root });

    const i18n = module.initI18n(['de-DE', 'en']);
    expect(i18n.language).toBe('de');
    expect(i18n.t('nav.logbook')).not.toBe('nav.logbook');
    expect(root.lang).toBe('de');

    await i18n.changeLanguage('en');
    expect(root.lang).toBe('en');
  });
});
