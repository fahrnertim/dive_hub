import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reads tokens.css itself, so a later palette edit is checked without a second copy of the colours.
const css = readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8');

function block(source: string, start: RegExp): string {
  const at = source.search(start);
  if (at < 0) throw new Error(`no block for ${start}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('unbalanced block');
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
}

const lightRoot = declarations(block(css, /^:root\s*\{/m));
const darkRoot = declarations(block(block(css, /@media\s*\(prefers-color-scheme:\s*dark\)/), /:root\s*\{/));

function scheme(overrides: Map<string, string>) {
  const all = new Map([...lightRoot, ...overrides]);
  const resolve = (name: string): string => {
    let value = all.get(name);
    if (value === undefined) throw new Error(`${name} is not defined`);
    for (let guard = 0; guard < 5; guard++) {
      const ref = /^var\((--[\w-]+)\)$/.exec(value);
      if (!ref) break;
      value = all.get(ref[1]!);
      if (value === undefined) throw new Error(`${ref[1]} is not defined`);
    }
    return value;
  };
  return resolve;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const schemes = { light: scheme(new Map()), dark: scheme(darkRoot) };

describe.each(Object.entries(schemes))('contrast, %s', (_name, color) => {
  const c = (token: string) => color(`--color-${token}`);
  const grounds = ['bg', 'surface', 'surface-sunken'];

  it.each(grounds.flatMap((g) => ['text', 'text-muted'].map((t) => [t, g] as const)))('%s on %s is at least 4.5', (t, g) => {
    expect(contrast(c(t), c(g))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['accent', 'danger', 'success'])('%s on surface is at least 4.5', (t) => {
    expect(contrast(c(t), c('surface'))).toBeGreaterThanOrEqual(4.5);
  });
  it('on-primary on primary is at least 4.5', () => {
    expect(contrast(c('on-primary'), c('primary'))).toBeGreaterThanOrEqual(4.5);
  });
  it.each([['on-accent', 'accent'], ['on-danger', 'danger'], ['success', 'success-soft'], ['danger', 'danger-soft']])('%s on %s is at least 4.5', (t, g) => {
    expect(contrast(c(t), c(g))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['bg', 'surface', 'surface-sunken'])('border-strong on %s is at least 3', (g) => {
    expect(contrast(c('border-strong'), c(g))).toBeGreaterThanOrEqual(3);
  });
});
