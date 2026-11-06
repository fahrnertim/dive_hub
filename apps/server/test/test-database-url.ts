// The PostgreSQL server the tests create their throwaway databases on (test/support.ts and test/e2e-server.ts).
// DIVEHUB_TEST_DATABASE_URL names the dedicated test server; TEST_DATABASE_URL is its older name. DATABASE_URL is
// the application's own database and is deliberately not read here: tests must never create or drop databases on it.
export const LOCAL_TEST_DATABASE_URL = 'postgres://divehub:divehub-dev@127.0.0.1:5432/divehub';

/** The test database server: an explicit test URL when set, otherwise the local development default. */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DIVEHUB_TEST_DATABASE_URL?.trim() || env.TEST_DATABASE_URL?.trim() || LOCAL_TEST_DATABASE_URL;
}
