// Rules from the UI review (docs/research/2026-10-03-ui-review.md, design system "Rules every page
// follows") that a browser test can't easily see, checked in the source so they don't come back.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '../src');
const files = (dir: string, ext: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : []);
const read = (path: string) => readFileSync(path, 'utf8');
// Comments blanked out (same length, so positions and line numbers stay right).
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
const css = files(src, '.css').map((path) => ({ path, text: withoutComments(read(path)) }));
const tsx = files(src, '.tsx').map((path) => ({ path, text: read(path) }));

/** Where each `@media (hover: hover) { … }` block starts and ends. */
function hoverBlocks(text: string): [number, number][] {
  const blocks: [number, number][] = [];
  for (const m of text.matchAll(/@media \(hover: hover\) \{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth += 1;
      if (text[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push([m.index, i]);
  }
  return blocks;
}

describe('styles', () => {
  it('transition named properties, never `all`', () => {
    for (const { path, text } of css) expect(text, path).not.toMatch(/transition:\s*all/);
  });

  it('use CSS :hover only inside @media (hover: hover), so it doesn’t stick on touch screens', () => {
    for (const { path, text } of css) {
      const blocks = hoverBlocks(text);
      for (const m of text.matchAll(/(?<!not\():hover/g)) {
        const line = text.slice(0, m.index).split('\n').length;
        expect(blocks.some(([from, to]) => m.index > from && m.index < to), `${path}:${line}`).toBe(true);
      }
    }
  });
});

describe('components', () => {
  it('put information in text, not in a title tooltip on an element', () => {
    for (const { path, text } of tsx) expect(text, path).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*?\btitle=/);
  });

  it('mark a busy button with isPending; isDisabled while pending only next to the one that is', () => {
    for (const { path, text } of tsx) {
      for (const m of text.matchAll(/isDisabled=\{(\w+)\.isPending\}/g)) {
        const around = text.slice(Math.max(0, m.index - 400), m.index + 400);
        expect(around, `${path}: ${m[0]} without an isPending button for ${m[1]}`).toContain(`isPending={${m[1]}.isPending`);
      }
    }
  });

  it('give every table column a header text', () => {
    for (const { path, text } of tsx) expect(text, path).not.toMatch(/head=\{\[[^\]]*(''|"")/);
  });
});

describe('texts', () => {
  const locales = files(join(src, 'i18n/locales'), '.json').map((path) => ({ path, text: read(path) }));

  it('use the ellipsis character, not three dots', () => {
    for (const { path, text } of locales) expect(text, path).not.toContain('...');
  });

  it('keep "…" on the line of the word before it (no-break space in German)', () => {
    for (const { path, text } of locales) expect(text, path).not.toMatch(/ …/);
  });
});
