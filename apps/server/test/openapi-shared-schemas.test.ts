// A schema several routes share is named once in the OpenAPI document (a component the routes $ref), so the generated
// client has one type for it. This test walks every route's request and response schemas, as write-openapi.ts
// produces them (no database), and fails when the same object schema of real size is inlined in more than two places.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { auth } from '../src/auth/cli-config.js';
import { createServices } from '../src/compose.js';
import type { Db } from '../src/db/client.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import type { SsiClient } from '../src/providers/ssi/ssi-client.js';
import { createSecretBox } from '../src/secrets/secret-box.js';
import type { SiteSourceAdapter } from '../src/sites/import/site-source.js';
import type { ImportSource } from '../src/sites/sources.js';
import type { BlobStore } from '../src/storage/blob-store.js';

/** An object schema counts when it has more than this many properties, or its JSON is longer than MAX_BYTES. */
const MAX_PROPERTIES = 3;
const MAX_BYTES = 500;
/** Inlined in this many places is fine (a request and its answer); one more and it needs a name. */
const MAX_PLACES = 2;

type Schema = { [key: string]: unknown };
const isObjectSchema = (s: Schema) => typeof s.properties === 'object' && s.properties !== null;
const sizable = (s: Schema) => Object.keys(s.properties as Schema).length > MAX_PROPERTIES || JSON.stringify(s).length > MAX_BYTES;

/** Calls `visit` on every schema inside `schema` (itself included), not following $ref; `visit` returning false stops descending. */
function walk(schema: unknown, visit: (s: Schema) => boolean) {
  if (Array.isArray(schema)) return schema.forEach((s) => walk(s, visit));
  if (typeof schema !== 'object' || schema === null) return;
  const s = schema as Schema;
  if (isObjectSchema(s) && !visit(s)) return;
  for (const [key, value] of Object.entries(s)) if (key !== 'examples' && key !== 'default') walk(value, visit);
}

type Doc = { paths: Record<string, Record<string, Schema>>; components?: { schemas?: Record<string, Schema> } };

/** The schemas of a request body's or response's media types. */
const mediaSchemas = (part: unknown) => Object.values(((part as Schema | undefined)?.content ?? {}) as Record<string, Schema>).map((m) => m.schema);

/** One operation's request and response schemas, each with where it is ("POST /api/dives 200"). */
function placesOfOperation(route: string, op: Schema) {
  return [
    ...mediaSchemas(op.requestBody).map((schema) => ({ where: `${route} body`, schema })),
    ...((op.parameters as Schema[] | undefined) ?? []).map((p) => ({ where: `${route} ${String(p.in)}`, schema: p.schema })),
    ...Object.entries((op.responses ?? {}) as Record<string, Schema>)
      .flatMap(([status, response]) => mediaSchemas(response).map((schema) => ({ where: `${route} ${status}`, schema }))),
  ];
}

/** Every route's schemas, and the named ones: a shape inside a component and inlined elsewhere is shared too. */
const placesOf = (doc: Doc) => [
  ...Object.entries(doc.paths).flatMap(([path, operations]) =>
    Object.entries(operations).flatMap(([method, op]) => placesOfOperation(`${method.toUpperCase()} ${path}`, op))),
  ...Object.entries(doc.components?.schemas ?? {}).map(([name, schema]) => ({ where: `component ${name}`, schema })),
];

/** The sizable object schemas inlined in more than MAX_PLACES places, outermost only, each with where it appears. */
function sharedInlineSchemas(doc: Doc) {
  const places = placesOf(doc);
  const placesByShape = new Map<string, Set<string>>();
  for (const { where, schema } of places) {
    walk(schema, (s) => {
      const key = JSON.stringify(s);
      if (sizable(s)) placesByShape.set(key, (placesByShape.get(key) ?? new Set()).add(where));
      return true;
    });
  }
  // A shape inside a shared one counts only where it appears outside it: naming the outer one names it there too.
  const shared = new Map<string, Set<string>>();
  for (const { where, schema } of places) {
    walk(schema, (s) => {
      const key = JSON.stringify(s);
      if ((placesByShape.get(key)?.size ?? 0) <= MAX_PLACES) return true;
      shared.set(key, (shared.get(key) ?? new Set()).add(where));
      return false;
    });
  }
  return [...shared].filter(([, where]) => where.size > MAX_PLACES)
    .map(([key, where]) => ({ properties: Object.keys((JSON.parse(key) as Schema).properties as Schema), where: [...where] }));
}

/** A shape's name in the failure: its first five property names. */
const shapeOf = (properties: string[]) => properties.slice(0, 5).join(', ');

describe('the OpenAPI document', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    // As write-openapi.ts builds it: describing the routes calls none of the services.
    const services = createServices({
      db: {} as Db, blobs: {} as BlobStore, auth, secrets: createSecretBox(undefined), siteSources: {} as Record<ImportSource, SiteSourceAdapter>,
      adapters: [createSsiAdapter({ client: {} as SsiClient })],
    });
    app = await buildApp({ ...services, baseUrl: 'http://localhost', maxUploadBytes: 1 });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('names every sizable object schema that more than two places share', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json();
    const shared = sharedInlineSchemas(doc);
    const offenders = shared.map(({ properties, where }) =>
      `{ ${shapeOf(properties)}${properties.length > 5 ? ', …' : ''} } inlined in ${where.length} places `
      + `(${where.slice(0, 3).join('; ')}${where.length > 3 ? '; …' : ''})`);
    expect(offenders, 'Give each a $id, register it with app.addSchema in app.ts and refer to it with refTo (http/schemas.ts), as users/views.ts does for UserView')
      .toEqual([]);
  });
});
