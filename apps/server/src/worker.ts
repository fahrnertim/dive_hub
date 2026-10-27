import { run, type Runner } from 'graphile-worker';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { BACKFILL_GAS_FIGURES_TASK, BACKFILL_POSITIONS_TASK, EXPIRE_WAITING_IMPORTS_TASK, FILL_CYLINDERS_TASK, PROCESS_IMPORT_TASK, type ImportService } from './imports/import-service.js';
import { IMPORT_SITES_TASK, type SiteImportService } from './sites/import/site-import-service.js';
import { PUSH_RUN_STEP_TASK, type PushRunService } from './providers/push-run-service.js';
import { WAITING_PUSHES_TASK, waitingPushesKey } from './providers/waiting-push-queue.js';
import { AUTOMATION_TICK_TASK, type WaitingPushService } from './providers/waiting-push-service.js';
import { FETCH_TASK, type ScheduledFetch } from './providers/scheduled-fetch.js';
import { CERTIFICATION_IMAGE_TASK, type CertificationService } from './certifications/certification-service.js';
import type { AiAccessService } from './mcp/access-service.js';
import type { AssessmentService } from './assessment/assessment-service.js';

/** Assesses every Dive not yet assessed with the current rules (ADR 0036): after a first start with them, or a new engine version. */
const ASSESS_DIVES_TASK = 'assess-dives';

/** Drops AI access log entries older than 90 days (ADR 0035). */
const PURGE_AI_ACCESS_LOG_TASK = 'purge-ai-access-log';

/** What the tasks log for the operator (the app's logger). */
export interface TaskLog {
  info(detail: object, message: string): void;
  warn(detail: object, message: string): void;
  error(detail: object, message: string): void;
}

/**
 * The Import's task: processes it, logs its files that failed, then hands its new Dives to the queue of Waiting pushes
 * (imports/ can't reach it). A failure there is logged, not thrown: the Import is done, and running it again changes
 * nothing; the operator sees which Import's new Dives weren't queued.
 */
export function processImportTask(
  imports: Pick<ImportService, 'processImport'>, waitingPushes: Pick<WaitingPushService, 'afterImport'>, log: TaskLog,
) {
  return async (payload: unknown) => {
    const { importId } = payload as { importId: string };
    log.info({ importId }, 'processing import');
    const outcome = await imports.processImport(importId);
    // The detail Users don't see (they get the reason code): here for the operator.
    for (const o of outcome) if (o.result === 'failed') log.warn({ importId, file: o.fileName, reason: o.reason, detail: o.message }, 'import file failed');
    if (outcome.length === 0) return;
    try {
      await waitingPushes.afterImport(importId);
    } catch (error) {
      log.error({ err: error, importId }, "an Import's new Dives could not be queued for sending");
    }
  };
}

export async function startWorker(
  pool: pg.Pool, imports: ImportService, siteImports: SiteImportService, aiAccesses: AiAccessService, assessments: AssessmentService, pushRuns: PushRunService,
  waitingPushes: WaitingPushService, scheduledFetch: ScheduledFetch, certifications: CertificationService, log: FastifyBaseLogger,
): Promise<Runner> {
  // An import still "running" now was cut off when the worker last stopped.
  await siteImports.failInterrupted();
  // A run that was going when the worker stopped goes on: its next step is queued again (ADR 0047).
  await pushRuns.requeueActive();
  const runner = await run({
    pgPool: pool,
    concurrency: 2,
    noHandleSignals: true,
    // Every night at 03:17 (UTC), the waiting Imports every hour, and automation every minute (ADR 0056).
    crontab: `17 3 * * * ${PURGE_AI_ACCESS_LOG_TASK}\n47 * * * * ${EXPIRE_WAITING_IMPORTS_TASK}\n* * * * * ${AUTOMATION_TICK_TASK}`,
    taskList: {
      [PROCESS_IMPORT_TASK]: processImportTask(imports, waitingPushes, log),
      [IMPORT_SITES_TASK]: async (payload) => {
        const { siteImportId } = payload as { siteImportId: string };
        log.info({ siteImportId }, 'importing dive sites');
        await siteImports.run(siteImportId);
        log.info({ siteImportId }, 'dive site import finished');
      },
      // One Dive of a Push run; the next step is queued after the Provider's pause, so no job sleeps (ADR 0047).
      [PUSH_RUN_STEP_TASK]: async (payload, helpers) => {
        const { runId } = payload as { runId: string };
        const next = await pushRuns.step(runId);
        if (next) await helpers.addJob(PUSH_RUN_STEP_TASK, { runId }, { runAt: new Date(Date.now() + next.afterMs), jobKey: `push-run:${runId}`, maxAttempts: 1 });
      },
      // One due Waiting push of a Connection (ADR 0056): again after the Provider's pause while more are due; else the
      // step has scheduled the job for the next due entry itself.
      [WAITING_PUSHES_TASK]: async (payload, helpers) => {
        const { connectionId } = payload as { connectionId: string };
        const next = await waitingPushes.step(connectionId);
        if (next) {
          await helpers.addJob(WAITING_PUSHES_TASK, { connectionId }, {
            runAt: new Date(Date.now() + next.afterMs), jobKey: waitingPushesKey(connectionId), queueName: waitingPushesKey(connectionId), maxAttempts: 1,
          });
        }
      },
      // Wakes Waiting pushes and queues the scheduled fetches that are due (ADR 0056).
      [AUTOMATION_TICK_TASK]: async () => {
        await waitingPushes.tick();
        await scheduledFetch.tick();
      },
      // One Connection's scheduled fetch: an unattended Import, which PROCESS_IMPORT_TASK then runs.
      [FETCH_TASK]: async (payload) => {
        const { connectionId } = payload as { connectionId: string };
        await scheduledFetch.fetch(connectionId);
      },
      // One card's picture (ADR 0050); three attempts, the last one ends as `failed`.
      [CERTIFICATION_IMAGE_TASK]: async (payload, helpers) => {
        const { certificationId } = payload as { certificationId: string };
        const final = helpers.job.attempts >= helpers.job.max_attempts;
        const outcome = await certifications.fetchImage(certificationId, { final });
        if (outcome === 'failed') log.warn({ certificationId }, 'a certification card picture could not be fetched');
      },
      [EXPIRE_WAITING_IMPORTS_TASK]: async () => {
        const ended = await imports.expireWaiting();
        if (ended > 0) log.info({ ended }, 'ended Imports nobody answered, and removed their uploads');
      },
      [PURGE_AI_ACCESS_LOG_TASK]: async () => {
        const purged = await aiAccesses.purgeLog();
        if (purged > 0) log.info({ purged }, 'purged old AI access log entries');
      },
      [ASSESS_DIVES_TASK]: async () => {
        const divers = await assessments.refreshAll();
        log.info({ divers }, 'dive assessments are up to date');
      },
      [BACKFILL_POSITIONS_TASK]: async () => {
        const read = await imports.backfillPositions();
        if (read > 0) log.info({ read }, 'read positions of earlier Recordings');
      },
      [BACKFILL_GAS_FIGURES_TASK]: async () => {
        const read = await imports.backfillGasFigures();
        if (read > 0) log.info({ read }, 'read the gas consumption of earlier Recordings');
      },
      [FILL_CYLINDERS_TASK]: async () => {
        const filled = await imports.fillCylinders();
        if (filled > 0) log.info({ filled }, 'made the Cylinders of earlier Dives from their tank pod data');
      },
    },
  });
  // Once per start; the job key keeps it to one queued job however many workers start.
  await runner.addJob(BACKFILL_POSITIONS_TASK, {}, { jobKey: BACKFILL_POSITIONS_TASK });
  await runner.addJob(BACKFILL_GAS_FIGURES_TASK, {}, { jobKey: BACKFILL_GAS_FIGURES_TASK });
  await runner.addJob(FILL_CYLINDERS_TASK, {}, { jobKey: FILL_CYLINDERS_TASK });
  await runner.addJob(ASSESS_DIVES_TASK, {}, { jobKey: ASSESS_DIVES_TASK });
  return runner;
}
