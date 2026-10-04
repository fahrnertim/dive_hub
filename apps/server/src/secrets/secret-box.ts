// Secrets Dive Hub keeps for outside services (ADR 0024): a Target's password or token, encrypted with
// AES-256-GCM under the operator's key (DIVEHUB_ENCRYPTION_KEY). The key never goes into the database, so a
// database backup alone doesn't reveal them. Each sealed value is bound to what it is for (the additional
// data, e.g. "ssi-password:<connection id>"), so it can't be copied into another row and opened there.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

export interface SecretBox {
  /** Whether the operator set a key. Without one, nothing is encrypted and passwords are never stored. */
  readonly available: boolean;
  /** `v1.<iv>.<ciphertext+tag>` (base64url), or the plain text when no key is set. */
  seal(plain: string, purpose: string): string;
  /** The plain text; throws when the value was sealed with another key or for another purpose. */
  open(sealed: string, purpose: string): string;
}

/** Reads DIVEHUB_ENCRYPTION_KEY: 32 bytes as base64 (e.g. `openssl rand -base64 32`). */
export function parseEncryptionKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`DIVEHUB_ENCRYPTION_KEY must be ${KEY_BYTES} bytes as base64 (openssl rand -base64 32); it decodes to ${key.length}`);
  }
  return key;
}

export function createSecretBox(key: Buffer | undefined): SecretBox {
  if (!key) {
    return {
      available: false,
      seal: (plain) => plain,
      open: (sealed) => {
        if (sealed.startsWith(`${VERSION}.`)) throw new Error('This value was encrypted, but DIVEHUB_ENCRYPTION_KEY is not set');
        return sealed;
      },
    };
  }
  return {
    available: true,
    seal(plain, purpose) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose, 'utf8'));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
    },
    open(sealed, purpose) {
      const [version, iv, body] = sealed.split('.');
      // A value stored before the key was set is plain text; it stays readable.
      if (version !== VERSION || !iv || !body) return sealed;
      const bytes = Buffer.from(body, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(purpose, 'utf8'));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      return Buffer.concat([decipher.update(bytes.subarray(0, bytes.length - TAG_BYTES)), decipher.final()]).toString('utf8');
    },
  };
}
