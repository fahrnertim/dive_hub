// The configuration from the environment: defaults, and an empty variable counting as unset (as Docker Compose's
// `VAR=` and `${VAR:-}` give one).
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://localhost/dives' };

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      port: 3000, host: '127.0.0.1', maxUploadBytes: 512 * 1024 * 1024, logLevel: 'info', inProcessWorker: true,
      baseUrl: 'http://localhost:3000', authSecret: undefined, trustedProxies: [], production: false,
    });
  });

  it('takes an empty variable as unset', () => {
    const config = loadConfig({
      ...base, DIVEHUB_PORT: '', DIVEHUB_MAX_UPLOAD_MB: '', DIVEHUB_HOST: '', DIVEHUB_LOG_LEVEL: '', DIVEHUB_WORKER: '',
      DIVEHUB_BASE_URL: '', DIVEHUB_DATA_DIR: '', DIVEHUB_AUTH_SECRET: '', DIVEHUB_CONTACT: ' ',
    });
    expect(config).toEqual(loadConfig(base));
  });

  it('reads what is set', () => {
    const config = loadConfig({ ...base, DIVEHUB_PORT: '8080', DIVEHUB_MAX_UPLOAD_MB: '2', DIVEHUB_BASE_URL: 'https://dives.example.com/x', DIVEHUB_TRUSTED_PROXIES: ' 10.0.0.1, ,10.0.0.0/8' });
    expect(config).toMatchObject({ port: 8080, maxUploadBytes: 2 * 1024 * 1024, baseUrl: 'https://dives.example.com', trustedProxies: ['10.0.0.1', '10.0.0.0/8'] });
  });

  it('refuses a number that is none', () => {
    expect(() => loadConfig({ ...base, DIVEHUB_PORT: 'eighty' })).toThrow('DIVEHUB_PORT');
    expect(() => loadConfig({ ...base, DIVEHUB_MAX_UPLOAD_MB: '-1' })).toThrow('DIVEHUB_MAX_UPLOAD_MB');
  });

  it('requires the database and, in production, the public URL, from the environment it is given', () => {
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow('DATABASE_URL');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow('DIVEHUB_BASE_URL');
    expect(loadConfig({ ...base, NODE_ENV: 'production', DIVEHUB_BASE_URL: 'https://dives.example.com' }).baseUrl).toBe('https://dives.example.com');
  });
});
