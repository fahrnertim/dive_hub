// Localization (ADR 0014): i18next with bundled translations. English is the source and fallback.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { pickLanguage } from './languages.ts';
import de from './locales/de.json';
import en from './locales/en.json';

export { LANGUAGES, pickLanguage, type Language } from './languages.ts';

export const resources = { en: { translation: en }, de: { translation: de } } as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: pickLanguage(null, navigator.languages),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes already
});

const setDocumentLanguage = (language: string) => { document.documentElement.lang = language; };
setDocumentLanguage(i18n.language);
i18n.on('languageChanged', setDocumentLanguage);

export default i18n;
