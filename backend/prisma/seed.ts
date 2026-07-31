/**
 * Seed script — creates one staff user per role so every workflow hand-off
 * can be exercised immediately. Idempotent: safe to run repeatedly.
 *
 * Run with: npx prisma db seed
 */
import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { Role } from '../src/generated/prisma/enums.js';

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(process.env['DATABASE_URL'] ?? ''),
});

const STAFF: Array<{ email: string; name: string; role: Role }> = [
  { email: 'creator@example.com', name: 'Cara Creator', role: Role.CREATOR },
  { email: 'reviewer@example.com', name: 'Rania Reviewer', role: Role.REVIEWER },
  { email: 'insurance@example.com', name: 'Iman Insurance', role: Role.INSURANCE },
  { email: 'admin@example.com', name: 'Adel Admin', role: Role.ADMIN },
];

async function main() {
  for (const user of STAFF) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role },
      create: user,
    });
    console.log(`seeded ${user.role.padEnd(9)} ${user.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
