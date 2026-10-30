// Names of entries in an account's own list (SSI's buddy list) against a Diver's: compared folded, never linked by.

/** A name to compare: trimmed, lower case, without accents. */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

/** Whether the answered entry's name differs from the Diver's `first last` (else the Diver's name). */
export function nameDiffers(answered: string, p: { name: string; firstName: string | null; lastName: string | null }): boolean {
  const own = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name;
  // SSI may answer an add by account before it has the profile: no name is no difference.
  return foldName(answered) !== '' && foldName(answered) !== foldName(own);
}
