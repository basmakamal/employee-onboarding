/**
 * One-time migration: move uploaded files from the original flat layout
 * (storage/{uuid}.ext) into per-employee shards (storage/employees/{id}/…)
 * and rewrite the storage keys in the database to match.
 *
 * Safe to re-run: keys that already contain a "/" are skipped, and a file
 * missing on disk is reported but leaves its row untouched.
 *
 *   npm run migrate:storage
 */
import { mkdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { prisma } from '../src/common/prisma.js';
import { uploadRoot } from '../src/common/storage.js';

let moved = 0;
let missing = 0;

async function relocate(flatKey: string, employeeId: string): Promise<string | null> {
  const newKey = `employees/${employeeId}/${flatKey}`;
  const from = resolve(uploadRoot, flatKey);
  const to = resolve(uploadRoot, newKey);
  try {
    mkdirSync(dirname(to), { recursive: true });
    await rename(from, to);
    moved += 1;
    return newKey;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      missing += 1;
      console.warn(`missing on disk, row left as-is: ${flatKey}`);
      return null;
    }
    throw err;
  }
}

const isFlat = (key: string | null): key is string => !!key && !key.includes('/');

async function main() {
  const docs = await prisma.onboardingDocument.findMany({
    where: { storageKey: { not: null } },
    select: { id: true, employeeId: true, storageKey: true },
  });
  for (const doc of docs.filter((d) => isFlat(d.storageKey))) {
    const newKey = await relocate(doc.storageKey as string, doc.employeeId);
    if (newKey) {
      await prisma.onboardingDocument.update({ where: { id: doc.id }, data: { storageKey: newKey } });
    }
  }

  const employees = await prisma.employee.findMany({
    where: { photoKey: { not: null } },
    select: { id: true, photoKey: true },
  });
  for (const e of employees.filter((r) => isFlat(r.photoKey))) {
    const newKey = await relocate(e.photoKey as string, e.id);
    if (newKey) await prisma.employee.update({ where: { id: e.id }, data: { photoKey: newKey } });
  }

  const contracts = await prisma.contract.findMany({
    where: { storageKey: { not: null } },
    select: { id: true, employeeId: true, storageKey: true },
  });
  for (const c of contracts.filter((r) => isFlat(r.storageKey))) {
    const newKey = await relocate(c.storageKey as string, c.employeeId);
    if (newKey) await prisma.contract.update({ where: { id: c.id }, data: { storageKey: newKey } });
  }

  const certificates = await prisma.criminalRecordProcess.findMany({
    where: { certificateStorageKey: { not: null } },
    select: { id: true, employeeId: true, certificateStorageKey: true },
  });
  for (const c of certificates.filter((r) => isFlat(r.certificateStorageKey))) {
    const newKey = await relocate(c.certificateStorageKey as string, c.employeeId);
    if (newKey) {
      await prisma.criminalRecordProcess.update({
        where: { id: c.id },
        data: { certificateStorageKey: newKey },
      });
    }
  }

  const notices = await prisma.offboarding.findMany({
    where: { noticeStorageKey: { not: null } },
    select: { id: true, employeeId: true, noticeStorageKey: true },
  });
  for (const n of notices.filter((r) => isFlat(r.noticeStorageKey))) {
    const newKey = await relocate(n.noticeStorageKey as string, n.employeeId);
    if (newKey) {
      await prisma.offboarding.update({ where: { id: n.id }, data: { noticeStorageKey: newKey } });
    }
  }

  console.log(`done: ${moved} file(s) moved, ${missing} missing on disk`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
