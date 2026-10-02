import { run, type Runner } from 'graphile-worker';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { PROCESS_IMPORT_TASK, type ImportService } from './imports/import-service.js';

export function startWorker(pool: pg.Pool, imports: ImportService, log: FastifyBaseLogger): Promise<Runner> {
  return run({
    pgPool: pool,
    concurrency: 2,
    noHandleSignals: true,
    taskList: {
      [PROCESS_IMPORT_TASK]: async (payload) => {
        const { importId } = payload as { importId: string };
        log.info({ importId }, 'processing import');
        await imports.processImport(importId);
      },
    },
  });
}
