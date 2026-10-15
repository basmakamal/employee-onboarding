/**
 * Encryption of single sensitive fields at rest (today: the IBAN), with
 * AES-256-GCM. A stored value looks like `enc:v1:<base64 iv|tag|ciphertext>`;
 * anything else is a value written before encryption was switched on and is
 * read as it is — so the key can be introduced on a live database and the
 * existing rows encrypted afterwards (see encryptExistingIbans).
 *
 * The key never lives in the database: it comes from DATA_ENCRYPTION_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

export class FieldCrypto {
  private readonly key: Buffer | null;

  constructor(base64Key: string | undefined) {
    this.key = base64Key ? Buffer.from(base64Key, 'base64') : null;
    if (this.key && this.key.length !== 32) throw new Error('the field encryption key must be 32 bytes');
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  static isEncrypted(value: string | null | undefined): boolean {
    return !!value && value.startsWith(PREFIX);
  }

  /** Encrypt a value for storage (unchanged when no key is configured). */
  encrypt(value: string): string;
  encrypt(value: null | undefined): null;
  encrypt(value: string | null | undefined): string | null;
  encrypt(value: string | null | undefined): string | null {
    if (value == null || value === '') return value ?? null;
    if (!this.key || FieldCrypto.isEncrypted(value)) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  /** Read a stored value back. A value from before encryption is returned as is. */
  decrypt(value: string | null | undefined): string | null {
    if (value == null) return null;
    if (!FieldCrypto.isEncrypted(value)) return value;
    if (!this.key) throw new Error('an encrypted value was found but DATA_ENCRYPTION_KEY is not set');
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

let shared = new FieldCrypto(undefined);

/** Set the key once at start-up (container). Until then values pass through unchanged. */
export function configureFieldCrypto(base64Key: string | undefined): FieldCrypto {
  shared = new FieldCrypto(base64Key);
  return shared;
}

/** The process-wide field crypto. */
export function fieldCrypto(): FieldCrypto {
  return shared;
}

/** "SA0380000000608010167519" → "SA•• •••• •••• •••• •••• 7519": enough to recognise, not to use. */
export function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  const last = clean.slice(-4);
  const hidden = `${clean.slice(0, 2)}${'•'.repeat(Math.max(0, clean.length - 6))}`;
  return `${hidden}${last}`.replace(/(.{4})/g, '$1 ').trim();
}
