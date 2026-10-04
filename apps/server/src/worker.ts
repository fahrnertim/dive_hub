import { run, type Runner } from 'graphile-worker';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { BACKFILL_POSITIONS_TASK, PROCESS_IMPORT_TASK, type ImportService } from './imports/import-service.js';
import { IMPORT_SITES_TASK, type SiteImportService } from './sites/import/site-import-service.js';

export async function startWorker(pool: pg.Pool, imports: ImportService, siteImports: SiteImportService, log: FastifyBaseLogger): Promise<Runner> {
  // An import still "running" now was cut off when the worker last stopped.
  await siteImports.failInterrupted();
  const runner = await run({
    pgPool: pool,
    concurrency: 2,
    noHandleSignals: true,
    taskList: {
      [PROCESS_IMPORT_TASK]: async (payload) => {
        const { importId } = payload as { importId: string };
        log.info({ importId }, 'processing import');
        await imports.processImport(importId);
      },
      [IMPORT_SITES_TASK]: async (payload) => {
        const { siteImportId } = payload as { siteImportId: string };
        log.info({ siteImportId }, 'importing dive sites');
        await siteImports.run(siteImportId);
        log.info({ siteImportId }, 'dive site import finished');
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
