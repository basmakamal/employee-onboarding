/** Secrets-at-rest crypto: roundtrip, tamper detection, legacy passthrough. */
import { describe, expect, it } from 'vitest';
import { decryptString, encryptString, isEncrypted } from '../src/common/crypto.js';

describe('crypto', () => {
  it('roundtrips and never stores plaintext', () => {
    const secret = 'my-smtp-app-password!';
    const stored = encryptString(secret);

    expect(stored).not.toContain(secret);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptString(stored)).toBe(secret);
  });

  it('produces a different ciphertext every time (random IV)', () => {
    expect(encryptString('x')).not.toBe(encryptString('x'));
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const stored = encryptString('secret');
    const tampered = stored.slice(0, -4) + 'AAAA';
    expect(() => decryptString(tampered)).toThrow();
  });

  it('passes legacy plaintext values through unchanged', () => {
    expect(decryptString('old-plain-password')).toBe('old-plain-password');
    expect(isEncrypted('old-plain-password')).toBe(false);
  });
});
