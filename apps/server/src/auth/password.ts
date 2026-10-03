import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * argon2id with OWASP's minimum (m = 19 MiB, t = 2, p = 1), which keeps sign-in affordable on
 * 2 GB NAS boxes (ADR 0011). The parameters are stored in each PHC string, so raising them later
 * still verifies old hashes.
 */
const ARGON2ID: Options = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

/** NIST SP 800-63B-4: at least 15 characters without a second factor; no composition rules. */
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

export const hashPassword = (password: string) => hash(password, ARGON2ID);
export const verifyPassword = ({ hash: stored, password }: { hash: string; password: string }) =>
  verify(stored, password);
