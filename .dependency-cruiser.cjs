// Module boundaries as code (proposed ADR 0053, research note 2026-10-22-agent-guardrails).
// Violations that existed on 2026-10-22 are in .dependency-cruiser-known-violations.json: only new ones fail.
// That file may only shrink (ADR 0023, amendment of 2026-10-22): after fixing one, run `pnpm lint:deps --update-baseline`.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
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
      comment: 'The database layer (apps/server/src/db) is the bottom layer: it imports nothing from the domain modules above it.',
      from: { path: '^apps/server/src/db/' },
      to: { path: '^apps/server/src/', pathNot: '^apps/server/src/db/' },
    },
    {
      name: 'routes-use-no-drizzle',
      severity: 'error',
      comment: 'Route files speak HTTP and call services; queries belong in a service or the db layer.',
      from: { path: '^apps/server/src/.*routes[^/]*[.]ts$' },
      to: { path: 'node_modules/drizzle-orm/' },
    },
    {
      name: 'ui-imports-no-page',
      severity: 'error',
      comment: 'Shared components (apps/web/src/ui) must not depend on a page (a component file at the top of apps/web/src).',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/[A-Z][^/]*\\.tsx$' },
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
