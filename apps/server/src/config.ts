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
  production: boolean;
  /** Public URL users open in the browser, e.g. https://dives.example.com (ADR 0011). */
  baseUrl: string;
  /** Secret for signing auth cookies; generated into the data directory when not set. */
  authSecret: string | undefined;
  /** Reverse proxies (IPs or CIDR ranges) whose X-Forwarded-For is trusted for the client IP. */
  trustedProxies: string[];
  /** Site import (ADR 0021): the operator's contact for the User-Agent, and other service endpoints (e.g. a paid Overpass). */
  contact: string | undefined;
  overpassUrl: string | undefined;
  wikidataSparqlUrl: string | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.DIVEHUB_PORT ?? 3000);
  const baseUrl = env.DIVEHUB_BASE_URL ?? (production ? required('DIVEHUB_BASE_URL') : `http://localhost:${port}`);
  return {
    databaseUrl: env.DATABASE_URL ?? required('DATABASE_URL'),
    dataDir: resolve(env.DIVEHUB_DATA_DIR ?? './data'),
    host: env.DIVEHUB_HOST ?? '127.0.0.1',
    port,
    inProcessWorker: (env.DIVEHUB_WORKER ?? 'in-process') === 'in-process',
    webDir: env.DIVEHUB_WEB_DIR ? resolve(env.DIVEHUB_WEB_DIR) : undefined,
    maxUploadBytes: Number(env.DIVEHUB_MAX_UPLOAD_MB ?? 512) * 1024 * 1024,
    logLevel: env.DIVEHUB_LOG_LEVEL ?? 'info',
    production,
    baseUrl: new URL(baseUrl).origin,
    authSecret: env.DIVEHUB_AUTH_SECRET || undefined,
    trustedProxies: (env.DIVEHUB_TRUSTED_PROXIES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    contact: env.DIVEHUB_CONTACT?.trim() || undefined,
    overpassUrl: env.DIVEHUB_OVERPASS_URL || undefined,
    wikidataSparqlUrl: env.DIVEHUB_WIKIDATA_SPARQL_URL || undefined,
  };
}
