// Names taken from a Provider's list of people (ADR 0029): tidied only when typed all in one case.
import { describe, expect, it } from 'vitest';
import { tidyName } from '../src/providers/buddy-service.js';

describe('tidyName', () => {
  it('capitalizes each part of a name typed all in lower case or all in capitals', () => {
    expect(tidyName('samuel dreier')).toBe('Samuel Dreier');
    expect(tidyName('SAMUEL DREIER')).toBe('Samuel Dreier');
    expect(tidyName('anna-lena o’brien')).toBe('Anna-Lena O’Brien');
    expect(tidyName('jörg ähler')).toBe('Jörg Ähler');
    expect(tidyName('  kai   lund ')).toBe('Kai Lund');
  });

  it('leaves a name with mixed case as it was typed', () => {
    expect(tidyName('Tyler McEowen')).toBe('Tyler McEowen');
    expect(tidyName('Jan van der Berg')).toBe('Jan van der Berg');
    expect(tidyName('s. Dreier')).toBe('s. Dreier');
  });
});
