import { avatarTone, initials } from '../lib/avatar.ts';

/**
 * A Diver as a circle with two letters, until Divers have pictures (UI redesign, "Buddies as stacked avatars").
 * Decoration: hidden from screen readers, so the name must stand beside it as text (visible or visually hidden).
 * `tone` tells people apart and means nothing.
 */
export function Avatar({ letters, tone = 0, inline = false }: { letters: string; tone?: 0 | 1 | 2; inline?: boolean }) {
  return <span className={inline ? 'avatar avatar-inline' : 'avatar'} data-tone={tone} aria-hidden="true" translate="no">{letters}</span>;
}

/** The circle of a named Diver: the same two letters and tone wherever the Diver appears. `inline` sits beside body text. */
export function DiverAvatar({ name, diverId, inline = false }: { name: string; diverId: string; inline?: boolean }) {
  return <Avatar letters={initials(name)} tone={avatarTone(diverId)} inline={inline} />;
}
