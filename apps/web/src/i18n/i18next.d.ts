// Typed translation keys: t('logbook.titel') is a type error. English defines the keys.
import 'i18next';
import type en from './locales/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
