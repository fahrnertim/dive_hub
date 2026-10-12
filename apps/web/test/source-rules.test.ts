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

  it('keep inputs at 16 px or more, or iOS zooms the page into them (mobile-native)', () => {
    for (const { path, text } of css) {
      for (const m of text.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
        const [, selector, body] = m;
        // .input and textarea, not .input-unit or .input-group.
        if (/(\.input|\binput|\btextarea)(?![\w-])/.test(selector!)) {
          expect(body, `${path}: ${selector!.trim()}`).not.toMatch(/font-size:\s*var\(--text-(xs|sm)\)/);
        }
      }
    }
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

  it('put the main action before Cancel in a row of form actions, left-aligned (UI/UX pass C14)', () => {
    for (const { path, text } of tsx) {
      expect(text, `${path}: dialogs use .form-actions like forms`).not.toContain('dialog-actions');
      for (const m of text.matchAll(/<div className="form-actions">([\s\S]*?)<\/div>/g)) {
        const row = m[1] ?? '';
        const cancel = row.indexOf("t('common.cancel')");
        const main = row.search(/variant="(primary|danger)"|type="submit"/);
        if (cancel >= 0 && main >= 0) expect(main, `${path}: Cancel before the main action in ${m[0].slice(0, 80)}`).toBeLessThan(cancel);
      }
    }
  });
});

// UI/UX pass slice 25g (C16, C18, C23): one convention for forms.
describe('form conventions (slice 25g)', () => {
  const locales = files(join(src, 'i18n/locales'), '.json').map((path) => ({ path, text: read(path) }));
  const ui = (name: string) => read(join(src, 'ui', name));

  it('mark required fields in the field components, and say what the mark means in every form (C16)', () => {
    for (const name of ['TextField.tsx', 'Fields.tsx']) expect(ui(name), name).toContain('field-required');
    expect(read(join(src, 'ui/index.ts'))).toContain("export { Form } from './Form.tsx'");
    expect(ui('Form.tsx')).toContain('form-legend');
    for (const { path, text } of tsx) {
      if (!/[\\/]ui[\\/]/.test(path)) expect(text, path).not.toMatch(/\bForm\b[^;\n]*from 'react-aria-components'/);
    }
  });

  it('do not write "(optional)" in a label: the required ones carry the mark (C16)', () => {
    for (const { path, text } of locales) expect(text, path).not.toMatch(/\(optional\)/i);
  });

  it('let a field start at the top of its row, so a hint beside it does not push the input down (C18)', () => {
    const rule = css.flatMap(({ text }) => [...text.matchAll(/(?:^|\n)\.field \{([^}]*)\}/g)].map((m) => m[1] ?? '')).join(' ');
    expect(rule).toMatch(/align-content:\s*start/);
  });

  it('leave the empty logbook to the import panel, no second panel with a line of its own (C23)', () => {
    for (const { path, text } of locales) expect(text, path).not.toMatch(/"empty": "(No dives yet|Noch keine Tauchgänge)/);
  });

  it('say what "Same as last dive" copies (C17)', () => {
    expect(read(join(src, 'DiveEditForm.tsx'))).toContain("t('cylinders.sameAsLastHint')");
  });
});

describe('icons and motion (ADR 0018)', () => {
  it('import Lucide only in ui/Icon.tsx, and use no text glyphs as icons', () => {
    for (const { path, text } of tsx) {
      if (!path.endsWith('Icon.tsx')) expect(text, path).not.toContain("from 'lucide-react'");
      expect(text, path).not.toMatch(/[▾▴▲▼◂▸]/);
    }
  });

  it('animate only transform and opacity', () => {
    for (const { path, text } of css) {
      for (const m of text.matchAll(/@keyframes [\w-]+ \{([^}]*\{[^}]*\})+\s*\}/g)) {
        const properties = [...m[0].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
        expect(properties.filter((p) => p !== 'transform' && p !== 'opacity'), `${path}: ${m[0].slice(0, 40)}`).toEqual([]);
      }
    }
  });

  it('time animations and transitions with the duration tokens, which drop to 0 for reduced motion', () => {
    for (const { path, text } of css) {
      for (const m of text.matchAll(/(?:animation|transition)\s*:[^;}]*/g)) {
        expect(m[0], path).not.toMatch(/\d+m?s\b/);
      }
    }
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
