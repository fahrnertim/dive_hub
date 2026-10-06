// Dropped files: only FIT files, Suunto JSON exports and zips go to the server (UI review A10, ADR 0037).
import { expect, it } from 'vitest';
import { splitImportable } from '../src/lib/importable.ts';

it('keeps FIT files, JSON files and zips, in any case, and names the rest', () => {
  expect(splitImportable(['a.fit', 'B.FIT', 'ScubaDiving_2026-02-10T10_00_00.json', 'export.zip', 'notes.txt', 'photo.jpg'])).toEqual({
    accepted: ['a.fit', 'B.FIT', 'ScubaDiving_2026-02-10T10_00_00.json', 'export.zip'], skipped: ['notes.txt', 'photo.jpg'],
  });
});
