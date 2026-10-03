/** Languages with a translation, by their own name (shown in the language picker). */
export const LANGUAGES = { en: 'English', de: 'Deutsch' } as const;
export type Language = keyof typeof LANGUAGES;

/** The User's choice if we have it, else the first browser language we have, else English. */
export function pickLanguage(preferred: string | null | undefined, browser: readonly string[]): Language {
  for (const tag of [preferred, ...browser]) {
    const base = tag?.toLowerCase().split('-')[0];
    if (base && base in LANGUAGES) return base as Language;
  }
  return 'en';
}
