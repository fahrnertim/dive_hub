// Unsaved changes (UI review B3): leaving asks while a form holds the guard, and a form that saved releases only its own.
import { describe, expect, it, vi } from 'vitest';
import { holdLeave, mayLeave } from '../src/lib/leave-guard.ts';

describe('the leave guard', () => {
  it('lets the User leave while no form holds it', () => {
    expect(mayLeave()).toBe(true);
  });

  it('asks the form that holds it, until it is released', () => {
    const ask = vi.fn(() => false);
    const release = holdLeave(ask);
    expect(mayLeave()).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
    release();
    expect(mayLeave()).toBe(true);
  });

  it('keeps a later form\'s guard when an earlier one releases', () => {
    const releaseFirst = holdLeave(() => false);
    const releaseSecond = holdLeave(() => false);
    releaseFirst();
    expect(mayLeave()).toBe(false);
    releaseSecond();
    expect(mayLeave()).toBe(true);
  });
});
