// When an open page asks again about the queue of Waiting pushes (ADR 0056): at the earliest due time, not on a timer.
import { describe, expect, it } from 'vitest';
import { pollUntilDue } from '../src/lib/waiting-push.ts';

const now = Date.parse('2026-10-27T12:00:00Z');
const at = (ms: number) => new Date(now + ms).toISOString();

describe('pollUntilDue', () => {
  it('asks nothing while no entry waits', () => {
    expect(pollUntilDue(null, now)).toBe(false);
    expect(pollUntilDue([], now)).toBe(false);
    expect(pollUntilDue([{ state: 'held', dueAt: at(0) }, { state: 'stopped', dueAt: at(-1000) }], now)).toBe(false);
  });

  it('asks again just after the earliest waiting entry is due', () => {
    expect(pollUntilDue([{ state: 'waiting', dueAt: at(30_000) }], now)).toBe(32_000);
    expect(pollUntilDue([{ state: 'waiting', dueAt: at(300_000) }, { state: 'waiting', dueAt: at(30_000) }, { state: 'held', dueAt: at(1000) }], now)).toBe(32_000);
  });

  it('keeps to the longest timer the browser has', () => {
    expect(pollUntilDue([{ state: 'waiting', dueAt: at(30 * 86_400_000) }], now)).toBe(2_147_483_647);
  });

  it('past due, asks every 5 s for a minute and then every minute', () => {
    expect(pollUntilDue([{ state: 'waiting', dueAt: at(0) }], now)).toBe(5_000);
    expect(pollUntilDue([{ state: 'waiting', dueAt: at(-59_000) }], now)).toBe(5_000);
    expect(pollUntilDue([{ state: 'waiting', dueAt: at(-60_000) }], now)).toBe(60_000);
  });
});
