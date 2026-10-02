// Typed client for the Dive Hub API, generated from the server's OpenAPI description (ADR 0004).
// Regenerate after API changes: pnpm --filter @dive-hub/api-client generate
import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };

export function createApiClient(baseUrl = '') {
  return createClient<paths>({ baseUrl, credentials: 'same-origin' });
}

export type ApiClient = ReturnType<typeof createApiClient>;
