// What the delete dialog offers about the Dive's copies at Providers, and the notice after deleting (ADR 0026, 0027).
import { describe, expect, it } from 'vitest';
import { deleteChoice, deletedNotice } from '../src/lib/deletion.ts';

const connection = { id: 'c1', state: 'active' as const, accountLabel: 'erika@example.com' };
const current = { remoteId: '9', remoteNumber: 8, sentAt: '2026-10-05T10:00:00Z', upToDate: true, updateRemovesVerification: false };

describe('deleteChoice', () => {
  it('waits while the Dive\'s state at the Providers loads', () => {
    expect(deleteChoice(undefined)).toBeUndefined();
  });

  it('asks nothing about a Provider the Dive isn\'t at', () => {
    expect(deleteChoice([{ provider: 'ssi', connection, current: null }])).toEqual({ ask: [], cannot: [] });
    expect(deleteChoice([])).toEqual({ ask: [], cannot: [] });
  });

  it('asks whether to delete it there too while its Diver is connected', () => {
    expect(deleteChoice([{ provider: 'ssi', connection, current }])).toEqual({ ask: [{ provider: 'ssi', remoteNumber: 8 }], cannot: [] });
    // Signing in again may still work (a kept password); the server says if not.
    expect(deleteChoice([{ provider: 'ssi', connection: { ...connection, state: 'needs_sign_in' }, current }])?.ask).toHaveLength(1);
  });

  it('says it stays there when its Diver is no longer connected, per Provider', () => {
    expect(deleteChoice([
      { provider: 'ssi', connection: null, current: { ...current, remoteNumber: null } },
      { provider: 'padi', connection, current },
    ])).toEqual({ ask: [{ provider: 'padi', remoteNumber: 8 }], cannot: [{ provider: 'ssi', remoteNumber: null }] });
  });
});

describe('deletedNotice', () => {
  const copy = (copy: 'deleted' | 'kept', provider = 'ssi') => ({ provider, name: provider.toUpperCase(), copy, remoteNumber: 8 });

  it('says what happened to the copies, deleted ones first', () => {
    expect(deletedNotice([])).toEqual({ key: 'deleted.notice', copies: [] });
    expect(deletedNotice([copy('kept')])).toEqual({ key: 'deleted.noticeKept', copies: [copy('kept')] });
    expect(deletedNotice([copy('deleted')])).toEqual({ key: 'deleted.noticeBoth', copies: [copy('deleted')] });
    expect(deletedNotice([copy('kept', 'padi'), copy('deleted')]).copies).toEqual([copy('deleted')]);
  });
});
