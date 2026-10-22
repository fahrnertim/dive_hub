// How a name is kept as a Diver's name. Lives in divers/ so diver-service.ts and providers/buddy-service.ts can both use it without importing each other.

/**
 * A name as a Diver's name: one a Provider keeps all in lower case (or all in capitals) gets a capital at the start of
 * each part ("samuel dreier" → "Samuel Dreier", "anna-lena" → "Anna-Lena"). A name with mixed case ("McEowen",
 * "van der Berg") was typed with care and stays as it is.
 */
export function tidyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed !== trimmed.toLocaleLowerCase() && trimmed !== trimmed.toLocaleUpperCase()) return trimmed;
  return trimmed.toLocaleLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toLocaleUpperCase());
}
