/**
 * Seed — staff users + the BRD's five SLA automation rules.
 * Idempotent: safe to run repeatedly. Run with: npx prisma db seed
 */
import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { Role, SlaUnit, SlaAction } from '../src/generated/prisma/enums.js';

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(process.env['DATABASE_URL'] ?? ''),
});

const STAFF: Array<{ email: string; name: string; role: Role }> = [
  { email: 'hr@example.com', name: 'HR Officer', role: Role.HR },
  { email: 'admin@example.com', name: 'System Admin', role: Role.ADMIN },
];

/** The BRD automation table (README §1), verbatim. */
const SLA_RULES = [
  {
    key: 'form-24h-reminder',
    status: 'AWAITING_FORM',
    afterValue: 24,
    afterUnit: SlaUnit.HOURS,
    action: SlaAction.REMIND,
    notifySubject: true,
    notifyHr: true,
  },
  {
    key: 'form-10d-expire',
    status: 'AWAITING_FORM',
    afterValue: 10,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.EXPIRE,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'contract-2wd-reminder',
    status: 'CONTRACT_CREATION',
    afterValue: 2,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'approval-5wd-daily',
    status: 'AWAITING_CONTRACT_APPROVAL',
    afterValue: 5,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND_DAILY,
    notifySubject: true,
    notifyHr: true,
  },
  {
    key: 'approval-10d-expire',
    status: 'AWAITING_CONTRACT_APPROVAL',
    afterValue: 10,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.EXPIRE,
    notifySubject: false,
    notifyHr: true,
  },
];

async function main() {
  for (const user of STAFF) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role },
      create: user,
    });
    console.log(`seeded user  ${user.role.padEnd(5)} ${user.email}`);
  }

  for (const rule of SLA_RULES) {
    const { key: _key, ...data } = rule;
    const existing = await prisma.slaRule.findFirst({
      where: { processKey: 'TRAINEE', status: data.status, action: data.action },
    });
    if (existing) {
      await prisma.slaRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.slaRule.create({ data: { processKey: 'TRAINEE', ...data } });
    }
    console.log(`seeded rule  ${rule.key}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
