/**
 * Storage hardening — magic-byte sniffing (a renamed executable must not
 * pass as a PDF), path-traversal guard on stored keys, and per-employee
 * sharding of upload destinations.
 */
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  employeeSubdir,
  storagePath,
  verifyUploadedFiles,
} from '../src/common/storage.js';
import { GuardFailedError } from '../src/workflow/errors.js';

const dir = mkdtempSync(join(tmpdir(), 'storage-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fileOn(name: string, bytes: number[], mimetype: string): Express.Multer.File {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(bytes));
  return { path, mimetype, fieldname: name, originalname: name } as Express.Multer.File;
}

describe('verifyUploadedFiles', () => {
  it('accepts files whose magic bytes match the declared type', async () => {
    const pdf = fileOn('ok.pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 'application/pdf');
    const png = fileOn('ok.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png');
    await expect(verifyUploadedFiles([pdf, png])).resolves.toBeUndefined();
    expect(existsSync(pdf.path)).toBe(true);
  });

  it('rejects a mismatch and removes EVERY file from the request', async () => {
    const good = fileOn('good.pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 'application/pdf');
    // An MZ executable renamed to .pdf with a spoofed content type.
    const evil = fileOn('evil.pdf', [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00], 'application/pdf');

    await expect(verifyUploadedFiles([good, evil])).rejects.toBeInstanceOf(GuardFailedError);
    expect(existsSync(good.path)).toBe(false);
    expect(existsSync(evil.path)).toBe(false);
  });

  it('rejects an empty/truncated file', async () => {
    const empty = fileOn('empty.pdf', [], 'application/pdf');
    await expect(verifyUploadedFiles([empty])).rejects.toBeInstanceOf(GuardFailedError);
  });
});

describe('storagePath', () => {
  it('refuses keys that escape the upload root', () => {
    expect(() => storagePath('../../etc/passwd')).toThrow(GuardFailedError);
    expect(() => storagePath('employees/../../secrets.txt')).toThrow(GuardFailedError);
  });

  it('resolves sharded keys inside the root', () => {
    expect(storagePath('employees/e1/a.pdf')).toContain('employees');
  });
});

describe('employeeSubdir', () => {
  it('shards per employee and rejects ids that are not path-safe', () => {
    expect(employeeSubdir('cku12abc')).toBe('employees/cku12abc');
    expect(() => employeeSubdir('../evil')).toThrow(GuardFailedError);
    expect(() => employeeSubdir('a/b')).toThrow(GuardFailedError);
  });
});
