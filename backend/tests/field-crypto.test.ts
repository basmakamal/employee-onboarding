/**
 * Bank details at rest: AES-256-GCM round trip, values written before the
 * key existed still readable, tampering detected, the mask shown on screen,
 * and the data-form write path storing the IBAN encrypted.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureFieldCrypto, FieldCrypto, maskIban } from '../src/common/field-crypto.js';
import { EmployeeRepository } from '../src/modules/employees/employee.repository.js';
import { encryptExistingIbans } from '../src/common/encrypt-existing.js';

const KEY = randomBytes(32).toString('base64');
const IBAN = 'SA0380000000608010167519';

afterEach(() => configureFieldCrypto(undefined));

describe('field encryption', () => {
  it('encrypts and decrypts, with a fresh IV each time', () => {
    const c = new FieldCrypto(KEY);
    const a = c.encrypt(IBAN);
    const b = c.encrypt(IBAN);
    expect(a).toMatch(/^enc:v1:/);
    expect(a).not.toContain(IBAN);
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe(IBAN);
  });

  it('reads a value stored before encryption as it is, and never encrypts twice', () => {
    const c = new FieldCrypto(KEY);
    expect(c.decrypt(IBAN)).toBe(IBAN);
    const once = c.encrypt(IBAN);
    expect(c.encrypt(once)).toBe(once);
  });

  it('without a key, values pass through unchanged', () => {
    const c = new FieldCrypto(undefined);
    expect(c.enabled).toBe(false);
    expect(c.encrypt(IBAN)).toBe(IBAN);
  });

  it('a tampered value or the wrong key is refused, not misread', () => {
    const stored = new FieldCrypto(KEY).encrypt(IBAN);
    const flipped = stored.slice(0, -4) + (stored.endsWith('A') ? 'B' : 'A') + stored.slice(-3);
    expect(() => new FieldCrypto(KEY).decrypt(flipped)).toThrow();
    expect(() => new FieldCrypto(randomBytes(32).toString('base64')).decrypt(stored)).toThrow();
  });

  it('masks all but the country code and the last four digits', () => {
    expect(maskIban(IBAN)).toBe('SA•• •••• •••• •••• •••• 7519');
    expect(maskIban(null)).toBeNull();
  });
});

describe('where IBANs are written', () => {
  it('the data form stores the IBAN encrypted', async () => {
    configureFieldCrypto(KEY);
    const update = vi.fn().mockResolvedValue({});
    await new EmployeeRepository({ employee: { update } } as never).updatePersonal('e1', { iban: IBAN, phone: '0500000000' });
    const data = update.mock.calls[0]![0].data as { iban: string; phone: string };
    expect(data.iban).toMatch(/^enc:v1:/);
    expect(data.phone).toBe('0500000000');
    expect(new FieldCrypto(KEY).decrypt(data.iban)).toBe(IBAN);
  });

  it('IBANs stored before the key are encrypted once at start-up', async () => {
    configureFieldCrypto(KEY);
    const findMany = vi.fn().mockResolvedValueOnce([{ id: 'e1', iban: IBAN }]).mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const n = await encryptExistingIbans({ employee: { findMany, updateMany } } as never);
    expect(n).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'e1', iban: IBAN }, data: { iban: expect.stringMatching(/^enc:v1:/) } });
  });
});
