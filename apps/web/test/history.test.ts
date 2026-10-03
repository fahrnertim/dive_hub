// The dive history merges edits one person makes in a row (UI review C2).
import { describe, expect, it } from 'vitest';
import { mergeEdits, type Revision } from '../src/lib/history.ts';

const edit = (id: string, at: string, actor: string, changes: Revision['changes']): Revision =>
  ({ id, at, actor: { type: 'user', id: actor, name: actor }, cause: 'edit', changes });

describe('merging edits', () => {
  it('merges edits by the same person within ten minutes, from the first value to the last', () => {
    const merged = mergeEdits([
      edit('3', '2026-10-03T10:09:00Z', 'erika', { maxDepthM: { from: 19, to: 20 } }),
      edit('2', '2026-10-03T10:05:00Z', 'erika', { notes: { from: null, to: 'Turtle' } }),
      edit('1', '2026-10-03T10:00:00Z', 'erika', { maxDepthM: { from: 18.5, to: 19 } }),
    ]);
    expect(merged).toEqual([expect.objectContaining({
      id: '3', count: 3,
      changes: { maxDepthM: { from: 18.5, to: 20 }, notes: { from: null, to: 'Turtle' } },
    })]);
  });

  it('keeps edits apart when the person, the cause or the time differ', () => {
    const merged = mergeEdits([
      edit('4', '2026-10-03T12:00:00Z', 'erika', { number: { from: 1, to: 2 } }),
      edit('3', '2026-10-03T10:30:00Z', 'erika', { number: { from: 3, to: 1 } }), // 90 minutes earlier
      edit('2', '2026-10-03T10:29:00Z', 'tim', { number: { from: 4, to: 3 } }),
      { ...edit('1', '2026-10-03T10:28:00Z', 'tim', {}), cause: 'primary-change' },
    ]);
    expect(merged.map((r) => r.id)).toEqual(['4', '3', '2', '1']);
  });

  it('drops a field that was changed and changed back', () => {
    const [merged] = mergeEdits([
      edit('2', '2026-10-03T10:01:00Z', 'erika', { number: { from: 43, to: 42 } }),
      edit('1', '2026-10-03T10:00:00Z', 'erika', { number: { from: 42, to: 43 } }),
    ]);
    expect(merged!.changes).toEqual({});
  });
});
