import { createHash, randomBytes } from 'node:crypto';

/** 256 bits, URL-safe: unguessable, so the token endpoints need no rate limit of their own. */
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
