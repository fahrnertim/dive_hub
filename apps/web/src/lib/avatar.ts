// What a Diver's circle shows (ui/Avatar.tsx): in the logbook, on the dive page and on the Divers page.

/**
 * Two letters for a Diver's circle: the first letters of the first and the last name, or the first two of a single
 * name. One letter collides too often (Lena, Lars, Lukas).
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(words[0] ?? '')];
  if (words.length < 2) return (first[0] ?? '').toUpperCase() + (first[1] ?? '');
  return (first[0]! + [...words.at(-1)!][0]!).toUpperCase();
}

/** One of three tones for a Diver's circle, always the same for the same Diver. It tells people apart; it means nothing. */
export function avatarTone(diverId: string): 0 | 1 | 2 {
  let sum = 0;
  for (let i = 0; i < diverId.length; i++) sum += diverId.charCodeAt(i);
  return (sum % 3) as 0 | 1 | 2;
}
