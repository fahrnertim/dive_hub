// Every translation is complete: the same keys and placeholders as English, and a text for every
// code the API can send (error codes, import results and reasons, statuses, roles), read from the
// OpenAPI document the client is generated from (ADR 0014).
import { describe, expect, it } from 'vitest';
import openapi from '../../../packages/api-client/openapi.json' with { type: 'json' };
import de from '../src/i18n/locales/de.json' with { type: 'json' };
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import type { StrayOverride } from '../src/lib/providers.ts';

// The type check fails here when a key under `providers.<id>` in en.json overrides nothing (it names that key).
const noStrayOverride: [StrayOverride] extends [never] ? true : StrayOverride = true;

type Tree = { [key: string]: string | Tree };

/** "a.b.c" → text, for every leaf. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort();

/** Every enum list in the OpenAPI document under a property with the given name. */
function enumsOf(property: string): string[] {
  const values = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === property && value && typeof value === 'object') {
        const schema = value as { enum?: string[]; anyOf?: { enum?: string[] }[]; items?: { enum?: string[] } };
        for (const v of [...(schema.enum ?? []), ...(schema.anyOf ?? []).flatMap((s) => s.enum ?? []), ...(schema.items?.enum ?? [])]) values.add(v);
      }
      walk(value);
    }
  };
  walk(openapi);
  return [...values];
}

const english = flatten(en as Tree);

describe.each([['de', de]])('%s translation', (_name, locale) => {
  const translated = flatten(locale as Tree);

  it('has every English key and no others', () => {
    expect([...translated.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('keeps the placeholders and markup of each text', () => {
    for (const [key, text] of english) expect(placeholders(translated.get(key) ?? ''), key).toEqual(placeholders(text));
  });

  it('translates something', () => {
    const differing = [...english].filter(([key, text]) => translated.get(key) !== text);
    expect(differing.length).toBeGreaterThan(english.size / 2);
  });
});

describe('texts a Provider words itself', () => {
  it.each([['en', en], ['de', de]])('override a text that exists, in %s', (_name, locale) => {
    expect(noStrayOverride).toBe(true);
    const texts = flatten(locale as Tree);
    const overrides = [...texts.keys()].filter((key) => key.startsWith('providers.'));
    expect(overrides.length).toBeGreaterThan(0);
    for (const key of overrides) {
      // providers.<id>.<text>: a problem's text lives under errors.*, every other text under provider.*.
      const text = key.split('.').slice(2).join('.');
      const generic = text.startsWith('errors.') ? text : `provider.${text}`;
      expect(texts.has(generic), `${key} overrides ${generic}, which doesn't exist`).toBe(true);
    }
  });
});

describe('codes from the API', () => {
  it.each([
    ['code', 'errors'],
    ['reason', 'import.reason'],
    ['errorCode', 'import.errorCode'],
    ['result', 'import.result'],
    ['waterType', 'vocabulary.waterType'],
    ['diveMode', 'vocabulary.diveMode'],
    ['decoModel', 'vocabulary.decoModel'],
    ['circuit', 'vocabulary.circuit'],
    ['cause', 'history.cause'],
    ['overrides', 'history.field'],
    ['action', 'provider.action'],
    ['outcome', 'provider.result'],
    ['notices', 'provider.notice'],
  ])('every %s has an English text under %s', (property, prefix) => {
    const codes = enumsOf(property);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(english.has(`${prefix}.${code}`), `${prefix}.${code}`).toBe(true);
  });
});
