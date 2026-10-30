import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/errors.js';

describe('errorMessage', () => {
  it("is an Error's message, and anything else thrown as text", () => {
    expect(errorMessage(new TypeError('bad'))).toBe('bad');
    expect(errorMessage('a string')).toBe('a string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
