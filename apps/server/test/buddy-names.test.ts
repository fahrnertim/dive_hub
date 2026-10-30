// Names taken from a Provider's list of people (ADR 0029): tidied only when typed all in one case, compared folded.
import { describe, expect, it } from 'vitest';
import { tidyName } from '../src/divers/diver-name.js';
import { foldName, nameDiffers } from '../src/providers/buddies/buddy-names.js';

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

describe('foldName and nameDiffers', () => {
  it('folds a name: trimmed, lower case, without accents', () => {
    expect(foldName('  Zoë Ähre ')).toBe('zoe ahre');
  });

  it('compares with the Diver’s first and last name, else its name; no name is no difference', () => {
    const lena = { name: 'Lena', firstName: 'Lena', lastName: 'Berg' };
    expect(nameDiffers('lena BERG', lena)).toBe(false);
    expect(nameDiffers('Samuel Dreier', lena)).toBe(true);
    expect(nameDiffers('', lena)).toBe(false);
    expect(nameDiffers('Kai', { name: 'Kai', firstName: null, lastName: null })).toBe(false);
  });
});
