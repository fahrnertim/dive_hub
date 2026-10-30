// The body of a route's 200 answer, for the lib/ files that api.ts reaches through lib/tools.ts (cylinders, weighting):
// they can't take api.ts's Ok without an import cycle.
import type { paths } from '@dive-hub/api-client';

export type Answer<P extends keyof paths> =
  paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer T } } } } } ? T : never;
