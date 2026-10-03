import { run, type Runner } from 'graphile-worker';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { BACKFILL_POSITIONS_TASK, PROCESS_IMPORT_TASK, type ImportService } from './imports/import-service.js';

export async function startWorker(pool: pg.Pool, imports: ImportService, log: FastifyBaseLogger): Promise<Runner> {
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
