// Providers over HTTP (ADR 0024, 0027): what each Provider offers, the User's Connections, and a Dive at each Provider.
// Every route needs a session, and a refusal about a Provider, a Certification or a Diver is answered here; the route plugins
// registered below take only the services they use.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Auth } from '../auth/auth.js';
import type { AssessmentRefresh } from '../dives/assessment-refresh.js';
import { requireUser } from '../auth/fastify.js';
import { answerErrors } from '../http/problems.js';
import type { CertificationService } from '../certifications/certification-service.js';
import { replyCertificationError } from '../certifications/certification-answers.js';
import { replyDiverError } from '../divers/diver-answers.js';
import { accountRoutes } from './account-routes.js';
import type { BuddyService } from './buddies/buddy-service.js';
import type { ConflictService } from './conflicts/conflict-service.js';
import { connectionRoutes } from './connection-routes.js';
import type { ConnectionService } from './connection-service.js';
import { decisionRoutes } from './conflicts/decision-routes.js';
import type { DiveImportService } from './dive-import/dive-import.js';
import { diveImportRoutes } from './dive-import/dive-import-routes.js';
import { diveProviderRoutes } from './dive-provider-routes.js';
import type { GoneDiveService } from './dive-import/gone-dives.js';
import { pushRunRoutes } from './push/push-run-routes.js';
import type { PushRunService } from './push/push-run-service.js';
import type { PushService } from './push/push-service.js';
import type { ProviderRegistry } from './registry.js';
import { answerProviderError } from './route-parts.js';
import type { ScheduledFetch } from './dive-import/scheduled-fetch.js';
import type { SitePickService } from './site-pick.js';
import type { WaitingPushService } from './waiting-push/waiting-push-service.js';

export interface ProviderRouteDeps {
  auth: Auth;
  providers: ProviderRegistry;
  connections: ConnectionService;
  pushes: PushService;
  pushRuns: PushRunService;
  buddies: BuddyService;
  sitePicks: SitePickService;
  diveImports: DiveImportService;
  goneDives: GoneDiveService;
  waitingPushes: WaitingPushService;
  scheduledFetch: ScheduledFetch;
  conflicts: ConflictService;
  certifications: CertificationService;
  assessments: AssessmentRefresh;
}

export const providerRoutes: FastifyPluginAsyncTypebox<ProviderRouteDeps> = async (app, { auth, providers, connections, pushes, pushRuns, buddies, sitePicks, diveImports, goneDives, waitingPushes, scheduledFetch, conflicts, certifications, assessments }) => {
  app.addHook('onRequest', requireUser(auth));
  // Linking and adding a buddy refuse as the Diver routes do.
  app.setErrorHandler(answerErrors(answerProviderError, replyCertificationError, replyDiverError));

  await app.register(pushRunRoutes, { pushRuns });
  await app.register(connectionRoutes, { providers, connections, diveImports, waitingPushes, conflicts, scheduledFetch });
  await app.register(accountRoutes, { buddies, certifications });
  await app.register(diveImportRoutes, { diveImports });
  await app.register(decisionRoutes, { providers, goneDives, conflicts, waitingPushes });
  await app.register(diveProviderRoutes, { pushes, sitePicks, assessments });
};
