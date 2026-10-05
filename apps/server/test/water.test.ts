// The hint on the dive page when the computer was set to other water than the site's (ADR 0025):
// which way the depths are off, by how much, and when it is too little to mention.
import { describe, expect, it } from 'vitest';
import { waterMismatch } from '../src/dives/water.js';

describe('the computer set to other water than the site has', () => {
  it('reads shallow in fresh water when set to salt, and deep in salt water when set to fresh', () => {
    expect(waterMismatch('fresh', { waterType: 'salt' })).toEqual({ computer: 'salt', site: 'fresh', depthPercent: -2.4 });
    expect(waterMismatch('salt', { waterType: 'fresh' })).toEqual({ computer: 'fresh', site: 'salt', depthPercent: 2.5 });
  });

  it('uses the density the computer recorded, also for a custom setting', () => {
    expect(waterMismatch('fresh', { waterType: 'custom', waterDensity: 1030 })).toMatchObject({ depthPercent: -2.9 });
    expect(waterMismatch('salt', { waterType: 'custom' })).toEqual({ computer: 'custom', site: 'salt', depthPercent: null });
  });

  it('says it differs, without a number, where brackish water is involved', () => {
    expect(waterMismatch('brackish', { waterType: 'salt' })).toEqual({ computer: 'salt', site: 'brackish', depthPercent: null });
    expect(waterMismatch('fresh', { waterType: 'brackish' })).toEqual({ computer: 'brackish', site: 'fresh', depthPercent: null });
  });

  it('says nothing below 1 % (EN 13319 in salt water), when they agree, or when either is unknown', () => {
    expect(waterMismatch('salt', { waterType: 'en13319' })).toBeNull();
    expect(waterMismatch('fresh', { waterType: 'en13319' })).toMatchObject({ depthPercent: -2 });
    expect(waterMismatch('salt', { waterType: 'salt' })).toBeNull();
    expect(waterMismatch(null, { waterType: 'salt' })).toBeNull();
    expect(waterMismatch('salt', {})).toBeNull();
    expect(waterMismatch('salt', undefined)).toBeNull();
  });
});
