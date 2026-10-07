/**
 * A Diver as a circle with two letters, until Divers have pictures (UI redesign, "Buddies as stacked avatars").
 * Decoration: hidden from screen readers, so the name must stand beside it as text (visible or visually hidden).
 * `tone` tells people apart and means nothing.
 */
export function Avatar({ letters, tone = 0 }: { letters: string; tone?: 0 | 1 | 2 }) {
  return <span className="avatar" data-tone={tone} aria-hidden="true" translate="no">{letters}</span>;
}
