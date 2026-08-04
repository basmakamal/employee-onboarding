import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

/**
 * AES-256-GCM for secrets at rest (e.g. the SMTP password in settings).
 * Key derived from JWT_REFRESH_SECRET — one secret to manage in .env.
 * Format: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
const KEY = createHash('sha256').update(`${config.JWT_REFRESH_SECRET}:settings-at-rest`).digest();
const PREFIX = 'enc:v1:';

export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Decrypts our format; passes through legacy plaintext values unchanged. */
export function decryptString(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
  if (!iv || !tag || !data) throw new Error('malformed encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
