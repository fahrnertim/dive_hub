// Signs the seeded User in once; every test starts with that session (storageState).
import { mkdirSync } from 'node:fs';
import { request, type FullConfig } from '@playwright/test';
import { E2E_USER } from './support.ts';

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  mkdirSync('e2e/.state', { recursive: true });
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const response = await api.post('/api/auth/sign-in/email', { data: { email: E2E_USER.email, password: E2E_USER.password } });
  if (!response.ok()) throw new Error(`sign-in failed: ${response.status()} ${await response.text()}`);
  await api.storageState({ path: 'e2e/.state/user.json' });
  await api.dispose();
}
