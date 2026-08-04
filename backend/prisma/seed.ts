/**
 * Seed — staff users + the BRD's five SLA automation rules.
 * Idempotent: safe to run repeatedly. Run with: npx prisma db seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { Role, SlaUnit, SlaAction } from '../src/generated/prisma/enums.js';

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(process.env['DATABASE_URL'] ?? ''),
});

/** Dev-only default password — change immediately in any real environment. */
const DEFAULT_PASSWORD = 'Passw0rd!';

const STAFF: Array<{ email: string; name: string; role: Role }> = [
  { email: 'hr@example.com', name: 'HR Officer', role: Role.HR },
  { email: 'insurance@example.com', name: 'Insurance Officer', role: Role.INSURANCE },
  { email: 'it@example.com', name: 'IT Officer', role: Role.IT },
  { email: 'finance@example.com', name: 'Finance Officer', role: Role.FINANCE },
  { email: 'admin@example.com', name: 'System Admin', role: Role.ADMIN },
];

/** The BRD automation table (README §1) + wider-coverage & escalation rules. */
const SLA_RULES: Array<{
  key: string;
  processKey?: string;
  status: string;
  afterValue: number;
  afterUnit: SlaUnit;
  action: SlaAction;
  notifySubject: boolean;
  notifyHr: boolean;
  notifyRole?: string;
  escalateToRole?: string;
}> = [
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
  // Escalation: form still incomplete after 5 days despite reminders → ADMIN.
  {
    key: 'form-5d-escalate',
    status: 'AWAITING_FORM',
    afterValue: 5,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.ESCALATE,
    notifySubject: false,
    notifyHr: false,
    escalateToRole: 'ADMIN',
  },
  // Wider coverage: stalled offboardings and long-held process cards.
  {
    key: 'offboarding-assets-5wd',
    processKey: 'OFFBOARDING',
    status: 'ASSETS_PENDING',
    afterValue: 5,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'offboarding-settlement-5wd',
    processKey: 'OFFBOARDING',
    status: 'SETTLEMENT',
    afterValue: 5,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
    notifyRole: 'FINANCE',
  },
  {
    key: 'gosi-hold-14d',
    processKey: 'GOSI',
    status: 'ON_HOLD',
    afterValue: 14,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
    notifyRole: 'INSURANCE',
  },
  {
    key: 'medical-hold-14d',
    processKey: 'MEDICAL_INSURANCE',
    status: 'ON_HOLD',
    afterValue: 14,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
    notifyRole: 'INSURANCE',
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  for (const user of STAFF) {
    // Never overwrite an existing password — only fill it when missing.
    const existing = await prisma.user.findUnique({ where: { email: user.email } });
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        ...(existing?.passwordHash ? {} : { passwordHash }),
      },
      create: { ...user, passwordHash },
    });
    console.log(`seeded user  ${user.role.padEnd(5)} ${user.email} (password: ${DEFAULT_PASSWORD})`);
  }

  for (const rule of SLA_RULES) {
    const { key: _key, ...data } = rule;
    const processKey = data.processKey ?? 'TRAINEE';
    const existing = await prisma.slaRule.findFirst({
      where: { processKey, status: data.status, action: data.action },
    });
    if (existing) {
      await prisma.slaRule.update({ where: { id: existing.id }, data: { ...data, processKey } });
    } else {
      await prisma.slaRule.create({ data: { ...data, processKey } });
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
