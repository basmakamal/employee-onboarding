import type { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';
import { FieldCrypto, fieldCrypto } from './field-crypto.js';

/**
 * Encrypt IBANs written before DATA_ENCRYPTION_KEY was set. Runs at start-up;
 * a value already encrypted is left alone, so running it again does nothing.
 * Without a key it only warns — the numbers stay as they are.
 */
export async function encryptExistingIbans(db: PrismaClient): Promise<number> {
  const crypto = fieldCrypto();
  if (!crypto.enabled) {
    logger.warn('DATA_ENCRYPTION_KEY is not set — IBANs are stored unencrypted (see .env.example)');
    return 0;
  }
  let done = 0;
  for (;;) {
    const rows = await db.employee.findMany({
      where: { iban: { not: null }, NOT: { iban: { startsWith: 'enc:v1:' } } },
      select: { id: true, iban: true },
      take: 200,
    });
    const plain = rows.filter((r) => r.iban && !FieldCrypto.isEncrypted(r.iban));
    if (plain.length === 0) break;
    for (const r of plain) {
      // Guarded: only rewrite the value that was read.
      await db.employee.updateMany({ where: { id: r.id, iban: r.iban }, data: { iban: crypto.encrypt(r.iban!) } });
      done += 1;
    }
  }
  return done;
}
