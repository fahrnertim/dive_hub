// What a Diver's circle shows: two letters and one of three tones.
import { describe, expect, it } from 'vitest';
import { avatarTone, initials } from '../src/lib/avatar.ts';

describe('initials', () => {
  it('takes the first letters of the first and the last name', () => {
    expect(initials('Lena Meier')).toBe('LM');
    expect(initials('Konstantin von Hohenzollern-Sigmaringen')).toBe('KH');
    expect(initials('  ulla   berg ')).toBe('UB');
  });

  it('takes two letters of a single name, so Lena and Lars differ', () => {
    expect(initials('Lena')).toBe('Le');
    expect(initials('Lars')).toBe('La');
    expect(initials('Ö')).toBe('Ö');
  });
});

describe('avatar tone', () => {
  it('is the same for the same Diver and one of the three tones', () => {
    const id = '0198c1de-7a11-7000-8000-00000000002a';
    expect(avatarTone(id)).toBe(avatarTone(id));
    expect([0, 1, 2]).toContain(avatarTone(id));
  });
});
