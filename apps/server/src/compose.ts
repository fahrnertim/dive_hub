// The services the server and the worker share (assessments, Providers, imports, site imports, AI accesses, setup,
// invitations), built in the order they use each other: main.ts, the server tests' createTestApp and the browser tests'
// server all build them here, and differ only in the parts they pass in (adapters, sources, clock). The services only
// the routes use (logbook, Divers, centres, Dives, sites, planning and the like) are built by buildApp in app.ts.
import type { Auth } from './auth/auth.js';
import type { Db } from './db/client.js';
import type { FastifyBaseLogger } from 'fastify';
import { createAssessmentService } from './assessment/assessment-service.js';
import { createImportService } from './imports/import-service.js';
import { createAiAccessService } from './mcp/access-service.js';
import type { Clock } from './providers/lease-service.js';
import { createProviderLayer } from './providers/layer.js';
import type { ProviderAdapter } from './providers/provider.js';
import type { ProviderLog } from './providers/waiting-push/waiting-push-queue.js';
import type { SecretBox } from './secrets/secret-box.js';
import { createSiteImportService } from './sites/import/site-import-service.js';
import type { SiteSourceAdapter } from './sites/import/site-source.js';
import type { ImportSource } from './sites/sources.js';
import type { BlobStore } from './storage/blob-store.js';
import { createInvitationService } from './users/invitation-service.js';
import { createSetupService } from './users/setup-service.js';
import type { WorkerDeps } from './worker.js';

export interface ServiceParts {
  db: Db;
  blobs: BlobStore;
  auth: Auth;
  secrets: SecretBox;
  /** The Providers of this instance (ADR 0027): the production SSI, or the fake and test-only ones. */
  adapters: ProviderAdapter[];
  siteSources: Record<ImportSource, SiteSourceAdapter>;
  /** The leases' clock (default: real time). */
  clock?: Clock;
  /** Where the provider layer's own faults go (the app's logger). */
  log?: ProviderLog;
}

export function createServices({ db, blobs, auth, secrets, adapters, siteSources, clock, log }: ServiceParts) {
  const assessments = createAssessmentService(db);
  const providers = createProviderLayer({ db, blobs, secrets, adapters, ...(clock && { clock }), ...(log && { log }) });
  // Imports of a Provider's dives run in the worker like uploads (ADR 0030).
  const imports = createImportService({ db, blobs, providerImports: providers.diveImports, afterImport: (userId) => assessments.refreshUser(userId) });
  return {
    db, blobs, auth, assessments, providers, imports,
    siteImports: createSiteImportService({ db, sources: siteSources }),
    aiAccesses: createAiAccessService(db, auth),
    setup: createSetupService(db),
    invitations: createInvitationService(db),
  };
}

export type Services = ReturnType<typeof createServices>;

/** What the worker's tasks use, from the services. */
export const workerDeps = (s: Services, log: FastifyBaseLogger): WorkerDeps => ({
  imports: s.imports, siteImports: s.siteImports, aiAccesses: s.aiAccesses, assessments: s.assessments, pushRuns: s.providers.pushRuns,
  waitingPushes: s.providers.waitingPushes, scheduledFetch: s.providers.scheduledFetch, certifications: s.providers.certifications, log,
});
