// What the delete dialog offers about SSI, and the notice after deleting (ADR 0026).
import { describe, expect, it } from 'vitest';
import { deletedNoticeKey, ssiChoice } from '../src/lib/deletion.ts';

const connection = { id: 'c1', state: 'active' as const, accountEmail: 'erika@example.com' };
const current = { remoteId: '9', remoteNumber: 8, sentAt: '2026-10-05T10:00:00Z', upToDate: true };

describe('ssiChoice', () => {
  it('waits while the Dive\'s SSI state loads', () => {
    expect(ssiChoice(undefined)).toBeUndefined();
  });

  it('asks nothing about SSI for a Dive that isn\'t there', () => {
    expect(ssiChoice({ connection, current: null })).toEqual({ kind: 'none' });
    expect(ssiChoice({ connection: null, current: null })).toEqual({ kind: 'none' });
  });

  it('asks whether to delete it in SSI too while its Diver is connected', () => {
    expect(ssiChoice({ connection, current })).toEqual({ kind: 'ask', remoteNumber: 8 });
    // Signing in again may still work (a kept password); the server says if not.
    expect(ssiChoice({ connection: { ...connection, state: 'needs_sign_in' }, current })).toEqual({ kind: 'ask', remoteNumber: 8 });
  });

  it('says it stays in SSI when its Diver is no longer connected', () => {
    expect(ssiChoice({ connection: null, current: { ...current, remoteNumber: null } })).toEqual({ kind: 'cannot', remoteNumber: null });
  });
});

describe('deletedNoticeKey', () => {
  it('says what happened to the SSI copy', () => {
    expect(deletedNoticeKey(null)).toBe('deleted.notice');
    expect(deletedNoticeKey('kept')).toBe('deleted.noticeKept');
    expect(deletedNoticeKey('deleted')).toBe('deleted.noticeBoth');
  });
});
