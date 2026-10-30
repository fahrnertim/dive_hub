// Module boundaries as code (ADR 0053, research note 2026-10-22-agent-guardrails).
// Violations that existed on 2026-10-22 are in .dependency-cruiser-known-violations.json: only new ones fail.
// That file may only shrink (ADR 0023, amendment of 2026-10-22): after fixing one, run `pnpm lint:baseline`.

const SERVER = '^apps/server/src/';

// The server's domain modules and the other domain modules each may import (ADR 0053). `name:type` allows type
// imports only; `routes` is the root routes.ts. A new import between modules adds its entry here, in the same
// commit, with the reason in the commit message; no new ADR needed. Removing an entry is always welcome.
const MODULE_IMPORTS = {
  assessment: ['divers', 'imports'],
  centres: ['divers:type', 'dives', 'providers', 'sites'],
  certifications: ['divers', 'dives', 'providers'],
  divers: ['centres', 'certifications', 'dives', 'providers'],
  dives: ['assessment:type', 'centres', 'divers', 'imports', 'providers', 'sites'],
  fit: ['imports', 'suunto'],
  imports: ['divers', 'dives', 'fit', 'sites', 'suunto'],
  lead: ['divers', 'dives'],
  mcp: ['assessment', 'divers', 'dives', 'planning', 'sites'],
  planning: ['divers', 'dives'],
  providers: ['certifications', 'divers', 'dives', 'imports', 'sites', 'routes'],
  sites: ['dives', 'providers'],
  suunto: ['imports'],
  users: ['dives'],
};
const target = (names) => `${SERVER}(${names.map((n) => (n === 'routes' ? 'routes[.]ts$' : `${n}/`)).join('|')})`;
const moduleRules = Object.entries(MODULE_IMPORTS).flatMap(([from, allowed]) => {
  const names = allowed.map((entry) => entry.split(':')[0]);
  const typeOnly = allowed.filter((entry) => entry.endsWith(':type')).map((entry) => entry.split(':')[0]);
  const others = [...Object.keys(MODULE_IMPORTS), 'routes'].filter((name) => name !== from && !names.includes(name));
  return [
    ...(others.length > 0 ? [{
      name: `module-imports-${from}`,
      severity: 'error',
      comment: `${from}/ may import only these domain modules: ${allowed.join(', ')} (MODULE_IMPORTS in .dependency-cruiser.cjs, ADR 0053).`,
      from: { path: `${SERVER}${from}/` },
      to: { path: target(others) },
    }] : []),
    ...(typeOnly.length > 0 ? [{
      name: `module-imports-${from}-types-only`,
      severity: 'error',
      comment: `${from}/ may import only types from ${typeOnly.join(', ')} (ADR 0053).`,
      from: { path: `${SERVER}${from}/` },
      to: { path: target(typeOnly), dependencyTypesNot: ['type-only'] },
    }] : []),
  ];
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...moduleRules,
    {
      name: 'no-cycles',
      severity: 'error',
      comment: 'Modules must not import each other in a circle, not even through type imports.',
      from: { path: '^apps/(server|web)/src/' },
      to: { circular: true },
    },
    {
      name: 'db-imports-no-domain-module',
      severity: 'error',
      comment: 'The database layer (apps/server/src/db) is the bottom layer: it imports nothing from the modules above it, only vocabulary.ts (value lists, below db; ADR 0053).',
      from: { path: '^apps/server/src/db/' },
      to: { path: '^apps/server/src/', pathNot: '^apps/server/src/(db/|vocabulary[.]ts$)' },
    },
    {
      name: 'routes-use-no-drizzle',
      severity: 'error',
      comment: 'Route files speak HTTP and call services; queries belong in a service or the db layer.',
      from: { path: '^apps/server/src/.*routes[^/]*[.]ts$' },
      to: { path: 'node_modules/drizzle-orm/' },
    },
    {
      name: 'routes-use-no-db-client',
      severity: 'error',
      comment: 'Route files do not touch the database client; a service holds it (db/schema.js stays allowed for its value lists; ADR 0053).',
      from: { path: '^apps/server/src/.*routes[^/]*[.]ts$' },
      to: { path: '^apps/server/src/db/client[.]ts$' },
    },
    {
      name: 'mcp-tools-use-no-drizzle',
      severity: 'error',
      comment: 'MCP tool files speak MCP and call services; their queries belong in mcp/read-service.ts or a domain service (db/schema.js stays allowed for its value lists).',
      from: { path: '^apps/server/src/mcp/tools-[^/]*[.]ts$' },
      to: { path: ['node_modules/drizzle-orm/', '^apps/server/src/db/client[.]ts$'] },
    },
    {
      name: 'ui-imports-no-page',
      severity: 'error',
      comment: 'Shared components (apps/web/src/ui) must not depend on a page (a component file at the top of apps/web/src).',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/[A-Z][^/]*\\.tsx$' },
    },
    {
      name: 'lib-imports-no-page',
      severity: 'error',
      comment: 'Web helpers and data hooks (apps/web/src/lib) must not depend on a page (ADR 0053).',
      from: { path: '^apps/web/src/lib/' },
      to: { path: '^apps/web/src/[A-Z][^/]*\\.tsx$' },
    },
    {
      // lib/ may import api.ts (amendment of 2026-10-29); api.ts takes from lib/ only what describes a query's
      // inputs. A new lib/ file for api.ts joins this list, with the reason in the commit message.
      name: 'api-imports-only-query-inputs-from-lib',
      severity: 'error',
      comment: 'api.ts takes from lib/ only the types and constants of its queries\' inputs: lib/logbook, sites-list, tools and waiting-push (ADR 0053, amendment of 2026-10-29).',
      from: { path: '^apps/web/src/api[.]ts$' },
      to: { path: '^apps/web/src/lib/', pathNot: '^apps/web/src/lib/(logbook|sites-list|tools|waiting-push)[.]ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Packages by their link in the app (apps/server/node_modules/drizzle-orm/…), not pnpm's store path with its
    // version, so the known violations survive an upgrade.
    preserveSymlinks: true,
    // Type-only imports count: a cycle through types still couples the modules.
    tsPreCompilationDeps: true,
    // The server imports its .ts files as .js (NodeNext), which dependency-cruiser maps to .ts by itself.
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    exclude: { path: '\\.(test|spec)\\.tsx?$' },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
