/**
 * Revert to the onboarding-only system — STEP 3: IBANs back to plain text.
 *
 * The HR platform stored IBANs encrypted ("enc:v1:…", AES-256-GCM with
 * DATA_ENCRYPTION_KEY from backend/.env). The onboarding system reads them as
 * plain text, so they are decrypted once, here. Run AFTER step 2 and after
 * `npx prisma generate` with the onboarding code:
 *
 *   npx tsx prisma/revert/03-decrypt-ibans.ts          (shows what would change)
 *   npx tsx prisma/revert/03-decrypt-ibans.ts --apply  (writes)
 *
 * A value that cannot be decrypted (wrong key) stops the script before
 * anything is written.
 */
import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import { prisma } from '../../src/common/prisma.js';

const PREFIX = 'enc:v1:';
const apply = process.argv.includes('--apply');

function decrypt(value: string, key: Buffer): string {
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

async function main() {
  const rows = await prisma.employee.findMany({ where: { iban: { startsWith: PREFIX } }, select: { id: true, iban: true } });
  console.log(`${rows.length} encrypted IBAN(s) found`);
  if (rows.length === 0) return;

  const keyText = process.env['DATA_ENCRYPTION_KEY']?.trim();
  if (!keyText) throw new Error('DATA_ENCRYPTION_KEY is not set in backend/.env — the encrypted IBANs cannot be read without it');
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64');

  // Decrypt everything first: one bad value stops the run before any write.
  const plain = rows.map((r) => ({ id: r.id, iban: decrypt(r.iban!, key) }));
  for (const p of plain) console.log(`  ${p.id}: ${p.iban.slice(0, 4)}…${p.iban.slice(-4)}`);

  if (!apply) {
    console.log('dry run — nothing written. Run again with --apply to save.');
    return;
  }
  for (const p of plain) await prisma.employee.update({ where: { id: p.id }, data: { iban: p.iban } });
  console.log(`${plain.length} IBAN(s) saved as plain text`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
