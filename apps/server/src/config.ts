import { resolve } from 'node:path';
import { parseEncryptionKey } from './secrets/secret-box.js';

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
  /** Where SSI's site list is downloaded (DIVEHUB_SSI_SITES_URL, ADR 0025). */
  ssiSitesUrl: string | undefined;
  /** Key for secrets kept for Targets (ADR 0024), e.g. SSI passwords; without it passwords are never kept. */
  encryptionKey: Buffer | undefined;
  /** SSI's app API; another endpoint only for tests. */
  ssiUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An empty variable counts as unset (Compose's `VAR=` gives one).
  const get = (name: string): string | undefined => env[name]?.trim() || undefined;
  const required = (name: string): string => {
    const value = get(name);
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const count = (name: string, fallback: number): number => {
    const value = Number(get(name) ?? fallback);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number, not ${env[name]}`);
    return value;
  };
  const production = env.NODE_ENV === 'production';
  const port = count('DIVEHUB_PORT', 3000);
  const baseUrl = get('DIVEHUB_BASE_URL') ?? (production ? required('DIVEHUB_BASE_URL') : `http://localhost:${port}`);
  const webDir = get('DIVEHUB_WEB_DIR');
  return {
    databaseUrl: required('DATABASE_URL'),
    dataDir: resolve(get('DIVEHUB_DATA_DIR') ?? './data'),
    host: get('DIVEHUB_HOST') ?? '127.0.0.1',
    port,
    inProcessWorker: (get('DIVEHUB_WORKER') ?? 'in-process') === 'in-process',
    webDir: webDir ? resolve(webDir) : undefined,
    maxUploadBytes: count('DIVEHUB_MAX_UPLOAD_MB', 512) * 1024 * 1024,
    logLevel: get('DIVEHUB_LOG_LEVEL') ?? 'info',
    production,
    baseUrl: new URL(baseUrl).origin,
    authSecret: get('DIVEHUB_AUTH_SECRET'),
    trustedProxies: (get('DIVEHUB_TRUSTED_PROXIES') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    contact: get('DIVEHUB_CONTACT'),
    overpassUrl: get('DIVEHUB_OVERPASS_URL'),
    wikidataSparqlUrl: get('DIVEHUB_WIKIDATA_SPARQL_URL'),
    ssiSitesUrl: get('DIVEHUB_SSI_SITES_URL'),
    encryptionKey: parseEncryptionKey(env.DIVEHUB_ENCRYPTION_KEY),
    ssiUrl: get('DIVEHUB_SSI_URL'),
  };
}
