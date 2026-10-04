// Signs the seeded User in once per e2e server and prepares its data (ADR 0023); every test starts with its
// server's session. The review capture (one server) starts from the seeded data only.
import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';
import { prepareServer } from './prepare.ts';
import { E2E_REVIEW, E2E_SERVERS, E2E_USER, serverUrl, sessionFile } from './support.ts';

export default async function globalSetup() {
  mkdirSync('e2e/.state', { recursive: true });
  await Promise.all(Array.from({ length: E2E_SERVERS }, async (_, slot) => {
    const baseURL = serverUrl(slot);
    const api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
    const response = await api.post('/api/auth/sign-in/email', { data: { email: E2E_USER.email, password: E2E_USER.password } });
    if (!response.ok()) throw new Error(`sign-in on ${baseURL} failed: ${response.status()} ${await response.text()}`);
    await api.storageState({ path: sessionFile(slot) });
    await api.dispose();
    if (!E2E_REVIEW) await prepareServer(baseURL, sessionFile(slot), slot);
  }));
}
