// Dropped files: only FIT files and zips go to the server (UI review A10).
import { expect, it } from 'vitest';
import { splitImportable } from '../src/lib/importable.ts';

it('keeps FIT files and zips, in any case, and names the rest', () => {
  expect(splitImportable(['a.fit', 'B.FIT', 'export.zip', 'notes.txt', 'photo.jpg'])).toEqual({
    accepted: ['a.fit', 'B.FIT', 'export.zip'], skipped: ['notes.txt', 'photo.jpg'],
  });
});
