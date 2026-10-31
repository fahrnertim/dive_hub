// JSON as SSI sends it: answer bodies, and lists kept as JSON text in record fields.
import { describe, expect, it } from 'vitest';
import { storedList, tryParseJson } from '../src/providers/ssi/ssi-json.js';

describe('tryParseJson', () => {
  it('reads JSON text, null included', () => {
    expect(tryParseJson('{"status":401}')).toEqual({ status: 401 });
    expect(tryParseJson('null')).toBeNull();
  });

  it('answers undefined for text that is not JSON', () => {
    expect(tryParseJson('<html>')).toBeUndefined();
    expect(tryParseJson('')).toBeUndefined();
  });
});

describe('storedList', () => {
  it('reads a list kept as JSON text, or one already parsed', () => {
    expect(storedList('[1,2,3]')).toEqual([1, 2, 3]);
    expect(storedList([{ d: 1 }])).toEqual([{ d: 1 }]);
  });

  it('answers null for an empty, unreadable or non-list value', () => {
    for (const v of [null, undefined, '', '  ', 'not json', '{"a":1}', '7', 7]) expect(storedList(v)).toBeNull();
  });
});
