// The one composition root: every service the server and the worker use (assessments, Providers, imports, logbook,
// Divers, centres, Dives, sites, planning and the rest), built in the order they use each other. start.ts, the server
// tests' createTestApp, the browser tests' server and write-openapi.ts all build them here, and differ only in the parts
// they pass in (adapters, sources, clock); buildApp in app.ts only registers the routes with them.
import type { Auth } from './auth/auth.js';
import type { Db } from './db/client.js';
import type { FastifyBaseLogger } from 'fastify';
import { createAssessmentService } from './assessment/assessment-service.js';
import { createCentreService } from './centres/centre-service.js';
import { createCandidateService } from './dives/candidates/candidate-service.js';
import { createLogbookCheckService } from './dives/checks/logbook-check-service.js';
import { createDeletionService } from './dives/deletion-service.js';
import { createDiveService } from './dives/dive-service.js';
import { createLogbookService } from './dives/logbook-service.js';
import { createMergeService } from './dives/merge-service.js';
import { createMergingService } from './dives/merging-service.js';
import { createDiverService } from './divers/diver-service.js';
import { createImportService } from './imports/import-service.js';
import { createAttemptLimit, TOKEN_ATTEMPTS } from './http/attempt-limit.js';
import { createLeadService } from './lead/lead-service.js';
import { createAiAccessService } from './mcp/access-service.js';
import { createPlanningService } from './planning/planning-service.js';
import type { Clock } from './providers/lease-service.js';
import { createProviderLayer } from './providers/layer.js';
import type { ProviderAdapter } from './providers/provider.js';
import { currentRemote } from './providers/remote-state.js';
import { ssiCentreDisplayName } from './providers/ssi/ssi-centre.js';
import type { ProviderLog } from './providers/waiting-push/waiting-push-queue.js';
import type { SecretBox } from './secrets/secret-box.js';
import { createSiteImportService } from './sites/import/site-import-service.js';
import type { SiteSourceAdapter } from './sites/import/site-source.js';
import { createSiteService } from './sites/site-service.js';
import type { ImportSource } from './sites/sources.js';
import type { BlobStore } from './storage/blob-store.js';
import { createInvitationService } from './users/invitation-service.js';
import { createPasswordResetService } from './users/password-reset-service.js';
import { createProfileService } from './users/profile-service.js';
import { createSessionService } from './users/session-service.js';
import { createSetupService } from './users/setup-service.js';
import { createUserAdminService } from './users/user-admin-service.js';
import type { WorkerDeps } from './worker.js';

export interface ServiceParts {
  db: Db;
  blobs: BlobStore;
  auth: Auth;
  secrets: SecretBox;
  /** The Providers of this instance (ADR 0027): the production SSI, or the fake and test-only ones. */
  adapters: ProviderAdapter[];
  siteSources: Record<ImportSource, SiteSourceAdapter>;
  /** The clock of leases and attempt limits (default: real time). */
  clock?: Clock;
  /** Where the provider layer's own faults go (the app's logger). */
  log?: ProviderLog;
}

export function createServices({ db, blobs, auth, secrets, adapters, siteSources, clock, log }: ServiceParts) {
  const assessments = createAssessmentService(db);
  const providers = createProviderLayer({ db, blobs, secrets, adapters, ...(clock && { clock }), ...(log && { log }) });
  // Imports of a Provider's dives run in the worker like uploads (ADR 0030).
  const imports = createImportService({ db, blobs, providerImports: providers.diveImports, afterImport: (userId) => assessments.refreshUser(userId) });
  const { pushes, waitingPushes } = providers;
  const logbook = createLogbookService(db);
  const dives = createDiveService(db);
  const checks = createLogbookCheckService(db);
  const merging = createMergingService(db, checks, { currentRemote, deletingItself: waitingPushes.deletingItself });
  return {
    db, blobs, auth, assessments, providers, imports,
    siteImports: createSiteImportService({ db, sources: siteSources }),
    aiAccesses: createAiAccessService(db, auth),
    setup: createSetupService(db),
    invitations: createInvitationService(db),
    passwordResets: createPasswordResetService(db),
    // One count per client IP across the public token routes (ADR 0061).
    tokenAttempts: createAttemptLimit(TOKEN_ATTEMPTS, clock ? () => clock.now() : undefined),
    profiles: createProfileService(db),
    sessions: createSessionService(db),
    userAdmin: createUserAdminService(db, blobs),
    logbook, dives, checks, merging,
    divers: createDiverService(db),
    centres: createCentreService(db, { ssi: ssiCentreDisplayName }),
    deletion: createDeletionService({ dives, logbook, pushes, waitingPushes }),
    merge: createMergeService({ merging, logbook, pushes }),
    candidates: createCandidateService(db),
    planning: createPlanningService(db),
    lead: createLeadService(db),
    sites: createSiteService(db),
  };
}

export type Services = ReturnType<typeof createServices>;

/** What the worker's tasks use, from the services. */
export const workerDeps = (s: Services, log: FastifyBaseLogger): WorkerDeps => ({
  imports: s.imports, siteImports: s.siteImports, aiAccesses: s.aiAccesses, assessments: s.assessments, pushRuns: s.providers.pushRuns,
  waitingPushes: s.providers.waitingPushes, scheduledFetch: s.providers.scheduledFetch, certifications: s.providers.certifications, log,
});
