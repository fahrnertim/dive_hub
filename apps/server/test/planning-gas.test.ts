// Gas numbers for a planned dive (ADR 0032, slice 21). Expected figures are worked by hand in the comments from the
// formulas in docs/research/2026-10-06-gas-and-ndl-tools.md, not taken from the code.
//
// Metres per bar of water = 1e5 / (density × 9.80665): fresh (1000) 10.1972, EN 13319 (1020) 9.9974, salt (1025) 9.9486.
// Surface pressure at sea level 1.01325 bar; at 900 m (standard atmosphere) 0.9097 bar.
import { describe, expect, it } from 'vitest';
import { bestMixPercent, eadMetres, endMetres, isHypoxic, modMetres } from '../src/planning/gas.js';

const SEA = { water: 'salt', altitudeM: 0 } as const;
const ean32 = { o2: 32, he: 0 };

describe('MOD of a gas mix', () => {
  it('is the depth where the ppO2 limit is reached, in salt water at sea level', () => {
    // EAN32 at 1.4: (1.4 / 0.32 − 1.01325) × 9.9486 = 3.36175 × 9.9486 = 33.44 m; at 1.6: 3.98675 × 9.9486 = 39.66 m.
    expect(modMetres(ean32, 1.4, SEA)).toBeCloseTo(33.44, 1);
    expect(modMetres(ean32, 1.6, SEA)).toBeCloseTo(39.66, 1);
  });

  it('is deeper in fresh water and a little deeper in EN 13319 than in salt water', () => {
    // 3.36175 × 10.1972 = 34.28 m fresh; 3.36175 × 9.9974 = 33.61 m for EN 13319.
    expect(modMetres(ean32, 1.4, { water: 'fresh', altitudeM: 0 })).toBeCloseTo(34.28, 1);
    expect(modMetres(ean32, 1.4, { water: 'en13319', altitudeM: 0 })).toBeCloseTo(33.61, 1);
  });

  it('counts the lower surface pressure at altitude', () => {
    // 900 m: (1 − 2.25577e-5 × 900)^5.25588 × 1.01325 = 0.9097 bar. Fresh water: (4.375 − 0.9097) × 10.1972 = 35.34 m.
    expect(modMetres(ean32, 1.4, { water: 'fresh', altitudeM: 900 })).toBeCloseTo(35.34, 1);
  });

  it('is shallower for a richer mix', () => {
    // Air (21 %) at 1.4: (6.6667 − 1.01325) × 9.9486 = 56.24 m. Pure oxygen at 1.6: (1.6 − 1.01325) × 9.9486 = 5.84 m.
    expect(modMetres({ o2: 21, he: 0 }, 1.4, SEA)).toBeCloseTo(56.24, 1);
    expect(modMetres({ o2: 100, he: 0 }, 1.6, SEA)).toBeCloseTo(5.84, 1);
  });
});

describe('best mix for a depth', () => {
  it('is the richest whole percent whose ppO2 stays within the limit at that depth', () => {
    // 30 m salt: 1.01325 + 30 / 9.9486 = 4.0288 bar; 1.4 / 4.0288 = 34.75 %, so 34 (rounded down, never over the limit).
    expect(bestMixPercent(30, 1.4, SEA)).toBe(34);
    // 18 m salt: 2.8226 bar; 1.4 / 2.8226 = 49.6 %, so 49.
    expect(bestMixPercent(18, 1.4, SEA)).toBe(49);
  });

  it('is capped at pure oxygen in shallow water', () => {
    // 3 m salt: 1.3147 bar; 1.6 / 1.3147 is over 100 %.
    expect(bestMixPercent(3, 1.6, SEA)).toBe(100);
  });
});

describe('equivalent air depth and narcotic depth', () => {
  it('EAD of EAN32 at 30 m in salt water is the air depth with the same nitrogen pressure', () => {
    // 4.0288 bar × 0.68 / 0.79 = 3.4680 bar; (3.4680 − 1.01325) × 9.9486 = 24.42 m.
    expect(eadMetres(ean32, 30, SEA)).toBeCloseTo(24.42, 1);
  });

  it('END counts oxygen as narcotic by default: only helium takes narcosis away', () => {
    // Trimix 21/35 at 40 m salt: 5.03385 bar × (1 − 0.35) = 3.2720; (3.2720 − 1.01325) × 9.9486 = 22.47 m.
    const trimix = { o2: 21, he: 35 };
    expect(endMetres(trimix, 40, SEA, { oxygenNarcotic: true })).toBeCloseTo(22.47, 1);
    // Air at 30 m is narcotic as itself: 30 m.
    expect(endMetres({ o2: 21, he: 0 }, 30, SEA, { oxygenNarcotic: true })).toBeCloseTo(30, 0);
  });

  it('END with oxygen not narcotic counts the nitrogen only', () => {
    // 5.03385 bar × 0.44 / 0.79 = 2.8036; (2.8036 − 1.01325) × 9.9486 = 17.81 m.
    expect(endMetres({ o2: 21, he: 35 }, 40, SEA, { oxygenNarcotic: false })).toBeCloseTo(17.81, 1);
  });
});

describe('hypoxic mixes', () => {
  it('calls a mix hypoxic below 18 % oxygen at the surface', () => {
    expect(isHypoxic({ o2: 17, he: 40 })).toBe(true);
    expect(isHypoxic({ o2: 18, he: 0 })).toBe(false);
    expect(isHypoxic({ o2: 21, he: 0 })).toBe(false);
  });
});
