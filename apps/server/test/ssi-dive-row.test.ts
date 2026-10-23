// The dive row SSI's own app sends (app 5.0.43): our declaration must match the table in the research note.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asBool, DIVE_ROW, type SsiValueType } from '../src/providers/ssi/ssi-dive-row.js';

const TYPES: Record<string, SsiValueType> = {
  int: 'int', 'int?': 'int', 'double?': 'double', 'String?': 'string', 'bool?': 'bool', 'List<int>?': 'intList', 'DateTime?': 'datetime',
};

describe('the dive row', () => {
  it("declares exactly the keys and types of the app's save (app 5.0.43)", () => {
    const note = readFileSync(new URL('../../../docs/research/2026-10-22-ssi-save-divelog-keys.md', import.meta.url), 'utf8');
    const rows = [...note.matchAll(/^\| \d+ \| `([^`]+)` \| (.+?) \|$/gm)].map((m) => {
      const cell = m[2]!.replace(/`/g, '');
      return [m[1]!, TYPES[cell] ?? 'unknown'] as const;
    });
    expect(rows).toHaveLength(345);
    expect(DIVE_ROW).toEqual(rows);
  });

  it('reads booleans the way SSI keeps them', () => {
    for (const v of [true, 1, '1']) expect(asBool(v)).toBe(true);
    for (const v of [false, 0, '0']) expect(asBool(v)).toBe(false);
    for (const v of [null, undefined, 2, 'yes']) expect(asBool(v)).toBeNull();
  });
});
