// Localization (ADR 0014): i18next with bundled translations. English is the source and fallback.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { pickLanguage } from './languages.ts';
import de from './locales/de.json';
import en from './locales/en.json';

const resources = { en: { translation: en }, de: { translation: de } } as const;

/** Starts i18next in the first of the given browser languages we have, and keeps <html lang> in step.
 * main.tsx calls it once before the first render; until then nothing here has run. */
export function initI18n(browser: readonly string[]) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: pickLanguage(null, browser),
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React escapes already
  });
  const setDocumentLanguage = (language: string) => { document.documentElement.lang = language; };
  setDocumentLanguage(i18n.language);
  i18n.on('languageChanged', setDocumentLanguage);
  return i18n;
}
