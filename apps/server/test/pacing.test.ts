// Pacing per Connection (ADR 0024, 0027): one action at a time, with the Provider's pause between them.
import { describe, expect, it } from 'vitest';
import { createPacer } from '../src/providers/pacing.js';

function clock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
    slept,
    sleep: async (ms: number) => { slept.push(ms); now += ms; },
  };
}

describe('pacing', () => {
  it('runs actions on one Connection one after another, pausing between them', async () => {
    const c = clock();
    const pace = createPacer(c);
    const order: string[] = [];
    const action = (name: string, ms: number) => pace('conn-1', 2000, async () => {
      order.push(`${name} starts`);
      await Promise.resolve();
      c.advance(ms);
      order.push(`${name} ends`);
      return name;
    });
    expect(await Promise.all([action('first', 300), action('second', 100)])).toEqual(['first', 'second']);
    expect(order).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
    expect(c.slept).toEqual([2000]);
  });

  it('waits only what is left of the pause, and not at all for another Connection', async () => {
    const c = clock();
    const pace = createPacer(c);
    await pace('conn-1', 2000, async () => undefined);
    c.advance(1500);
    await pace('conn-1', 2000, async () => undefined);
    await pace('conn-2', 2000, async () => undefined);
    expect(c.slept).toEqual([500]);
  });

  it('keeps the line moving after a failed action', async () => {
    const c = clock();
    const pace = createPacer(c);
    const failed = pace('conn-1', 0, async () => { throw new Error('refused'); });
    const next = pace('conn-1', 0, async () => 'next');
    await expect(failed).rejects.toThrow('refused');
    expect(await next).toBe('next');
  });
});
