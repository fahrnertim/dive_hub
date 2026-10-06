import { run, type Runner } from 'graphile-worker';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { BACKFILL_POSITIONS_TASK, PROCESS_IMPORT_TASK, type ImportService } from './imports/import-service.js';
import { IMPORT_SITES_TASK, type SiteImportService } from './sites/import/site-import-service.js';
import type { AiAccessService } from './mcp/access-service.js';

/** Drops AI access log entries older than 90 days (ADR 0035). */
const PURGE_AI_ACCESS_LOG_TASK = 'purge-ai-access-log';

export async function startWorker(
  pool: pg.Pool, imports: ImportService, siteImports: SiteImportService, aiAccesses: AiAccessService, log: FastifyBaseLogger,
): Promise<Runner> {
  // An import still "running" now was cut off when the worker last stopped.
  await siteImports.failInterrupted();
  const runner = await run({
    pgPool: pool,
    concurrency: 2,
    noHandleSignals: true,
    // Every night at 03:17 (UTC).
    crontab: `17 3 * * * ${PURGE_AI_ACCESS_LOG_TASK}`,
    taskList: {
      [PROCESS_IMPORT_TASK]: async (payload) => {
        const { importId } = payload as { importId: string };
        log.info({ importId }, 'processing import');
        const outcome = await imports.processImport(importId);
        // The detail Users don't see (they get the reason code): here for the operator.
        for (const o of outcome) if (o.result === 'failed') log.warn({ importId, file: o.fileName, reason: o.reason, detail: o.message }, 'import file failed');
      },
      [IMPORT_SITES_TASK]: async (payload) => {
        const { siteImportId } = payload as { siteImportId: string };
        log.info({ siteImportId }, 'importing dive sites');
        await siteImports.run(siteImportId);
        log.info({ siteImportId }, 'dive site import finished');
      },
      [PURGE_AI_ACCESS_LOG_TASK]: async () => {
        const purged = await aiAccesses.purgeLog();
        if (purged > 0) log.info({ purged }, 'purged old AI access log entries');
      },
      [BACKFILL_POSITIONS_TASK]: async () => {
        const read = await imports.backfillPositions();
        if (read > 0) log.info({ read }, 'read positions of earlier Recordings');
      },
    },
  });
  // Once per start; the job key keeps it to one queued job however many workers start.
  await runner.addJob(BACKFILL_POSITIONS_TASK, {}, { jobKey: BACKFILL_POSITIONS_TASK });
  return runner;
}
