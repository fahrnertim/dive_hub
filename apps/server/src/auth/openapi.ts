import { PUBLIC_AUTH_PATHS, type Auth } from './auth.js';

type OpenApiDoc = {
  paths?: Record<string, Record<string, Record<string, unknown>>>;
  components?: { schemas?: Record<string, unknown> };
};

/**
 * Our OpenAPI document plus the Better Auth endpoints we expose (PUBLIC_AUTH_PATHS), so generated
 * clients cover sign-in too. Authentication is the session cookie, so Better Auth's per-operation
 * bearer/API-key security entries are dropped.
 */
export async function withAuthEndpoints<T extends object>(ours: T, auth: Auth): Promise<T> {
  const theirs = (await auth.api.generateOpenAPISchema()) as unknown as OpenApiDoc;
  const doc = structuredClone(ours) as T & OpenApiDoc;
  doc.paths ??= {};
  const used = new Set<string>();
  for (const path of PUBLIC_AUTH_PATHS) {
    const operations = theirs.paths?.[path];
    if (!operations) continue;
    doc.paths[`/api/auth${path}`] = Object.fromEntries(Object.entries(operations).map(([method, { security: _, ...op }]) => {
      for (const [, name] of JSON.stringify(op).matchAll(/"#\/components\/schemas\/(\w+)"/g)) used.add(name!);
      return [method, { ...op, tags: ['Auth'] }];
    }));
  }
  if (used.size > 0) {
    doc.components ??= {};
    doc.components.schemas ??= {};
    for (const name of used) doc.components.schemas[name] = theirs.components?.schemas?.[name];
  }
  return doc;
}
