import { resolve } from 'node:path';

export interface Config {
  databaseUrl: string;
  dataDir: string;
  host: string;
  port: number;
  /** Run the background worker inside this process (default) or not (separate worker service). */
  inProcessWorker: boolean;
  /** Directory with the built web client, served as static files when present. */
  webDir: string | undefined;
  maxUploadBytes: number;
  logLevel: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? required('DATABASE_URL'),
    dataDir: resolve(env.DIVEHUB_DATA_DIR ?? './data'),
    host: env.DIVEHUB_HOST ?? '127.0.0.1',
    port: Number(env.DIVEHUB_PORT ?? 3000),
    inProcessWorker: (env.DIVEHUB_WORKER ?? 'in-process') === 'in-process',
    webDir: env.DIVEHUB_WEB_DIR ? resolve(env.DIVEHUB_WEB_DIR) : undefined,
    maxUploadBytes: Number(env.DIVEHUB_MAX_UPLOAD_MB ?? 512) * 1024 * 1024,
    logLevel: env.DIVEHUB_LOG_LEVEL ?? 'info',
  };
}
