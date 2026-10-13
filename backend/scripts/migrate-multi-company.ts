/**
 * Legacy → multi-company mapping (Phase 2).
 *
 * Every database before Oct 2026 held exactly one company. This script makes
 * that explicit: it creates (or reuses) the company you name, assigns every
 * unmapped employee and asset to it, builds org units from the distinct
 * `department` values and positions from the distinct `jobTitle` values,
 * links employees to them where the value matches exactly, and maps staff
 * accounts to roles (ADMIN → SUPER_ADMIN globally, others → the same-named
 * role inside the company).
 *
 * Nothing is guessed: a row whose department / title matches no unit is
 * left unlinked and LISTED in the report for review. Run with --dry-run
 * first (the default when --apply is absent); --apply writes everything in
 * ONE transaction and saves the report under storage/migration-reports/.
 *
 *   npx tsx scripts/migrate-multi-company.ts --code RIYADA --name-ar رياضة --name-en Riyada
 *   npx tsx scripts/migrate-multi-company.ts --code RIYADA --name-ar رياضة --name-en Riyada --apply
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { SYSTEM_ROLES } from '../src/auth/authz/permissions.js';

// ───────────────────────────────────────────────────────────── pure planning

export interface LegacyEmployee {
  id: string;
  companyId: string | null;
  department: string | null;
  jobTitle: string | null;
  orgUnitId: string | null;
  positionId: string | null;
}
export interface LegacyUser {
  id: string;
  email: string;
  role: string;
  assignmentCount: number;
}
export interface LegacyAsset {
  id: string;
  companyId: string | null;
}
export interface RoleRow {
  id: string;
  code: string;
}

export interface MappingInput {
  companyId: string;
  employees: LegacyEmployee[];
  users: LegacyUser[];
  assets: LegacyAsset[];
  roles: RoleRow[];
  /** Units / positions that already exist in the company (code → id), so re-runs reuse them. */
  existingUnits: Record<string, string>;
  existingPositions: Record<string, string>;
}

export interface MappingPlan {
  employeesToAssign: string[];
  assetsToAssign: string[];
  unitsToCreate: Array<{ code: string; name: string }>;
  positionsToCreate: Array<{ code: string; title: string }>;
  /** employeeId → unit code / position code (only exact matches). */
  employeeUnit: Record<string, string>;
  employeePosition: Record<string, string>;
  assignments: Array<{ userId: string; roleCode: string; global: boolean }>;
  /** For review — never acted on. */
  review: {
    employeesWithoutDepartment: string[];
    employeesWithoutJobTitle: string[];
    usersWithUnknownRole: Array<{ id: string; role: string }>;
    usersAlreadyAssigned: string[];
  };
}

/** A stable code from a human label: "Customer Service" → CUSTOMER_SERVICE. */
export function codeOf(label: string): string {
  const ascii = label
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  // Arabic-only labels leave nothing printable; fall back to a hash so the code is still stable.
  if (ascii) return ascii.slice(0, 60);
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `UNIT_${h.toString(16).toUpperCase()}`;
}

export function planMapping(input: MappingInput): MappingPlan {
  const plan: MappingPlan = {
    employeesToAssign: [],
    assetsToAssign: [],
    unitsToCreate: [],
    positionsToCreate: [],
    employeeUnit: {},
    employeePosition: {},
    assignments: [],
    review: {
      employeesWithoutDepartment: [],
      employeesWithoutJobTitle: [],
      usersWithUnknownRole: [],
      usersAlreadyAssigned: [],
    },
  };

  const unitCodes = new Map<string, string>(); // code → label
  const positionCodes = new Map<string, string>();

  for (const e of input.employees) {
    if (e.companyId === null) plan.employeesToAssign.push(e.id);
    else if (e.companyId !== input.companyId) continue; // belongs elsewhere — untouched

    const dept = e.department?.trim();
    if (!dept) plan.review.employeesWithoutDepartment.push(e.id);
    else if (!e.orgUnitId) {
      const code = codeOf(dept);
      if (!input.existingUnits[code] && !unitCodes.has(code)) unitCodes.set(code, dept);
      plan.employeeUnit[e.id] = code;
    }

    const title = e.jobTitle?.trim();
    if (!title) plan.review.employeesWithoutJobTitle.push(e.id);
    else if (!e.positionId) {
      const code = codeOf(title);
      if (!input.existingPositions[code] && !positionCodes.has(code)) positionCodes.set(code, title);
      plan.employeePosition[e.id] = code;
    }
  }
  plan.unitsToCreate = [...unitCodes].map(([code, name]) => ({ code, name }));
  plan.positionsToCreate = [...positionCodes].map(([code, title]) => ({ code, title }));

  for (const a of input.assets) if (a.companyId === null) plan.assetsToAssign.push(a.id);

  const roleByCode = new Map(input.roles.map((r) => [r.code, r.id]));
  for (const u of input.users) {
    if (u.assignmentCount > 0) {
      plan.review.usersAlreadyAssigned.push(u.id);
      continue;
    }
    const roleCode = u.role === 'ADMIN' ? 'SUPER_ADMIN' : u.role;
    if (!roleByCode.has(roleCode)) {
      plan.review.usersWithUnknownRole.push({ id: u.id, role: u.role });
      continue;
    }
    plan.assignments.push({ userId: u.id, roleCode, global: roleCode === 'SUPER_ADMIN' });
  }
  return plan;
}

// ───────────────────────────────────────────────────────────────── runner

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const code = arg('code');
  const nameAr = arg('name-ar');
  const nameEn = arg('name-en');
  const apply = process.argv.includes('--apply');
  if (!code || !nameAr || !nameEn) {
    console.error('usage: --code RIYADA --name-ar <arabic> --name-en <english> [--apply]');
    process.exit(2);
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env['DATABASE_URL'] ?? '') });
  try {
    const roles = await prisma.roleDefinition.findMany({ select: { id: true, code: true } });
    const missing = SYSTEM_ROLES.map((r) => r.code).filter((c) => !roles.some((r) => r.code === c));
    if (missing.length) {
      console.error(`system roles missing: ${missing.join(', ')} — run \`npx prisma db seed -- --rules-only\` first`);
      process.exit(2);
    }

    const existing = await prisma.company.findUnique({ where: { code } });
    const companyId = existing?.id ?? 'NEW';
    const [employees, users, assets, units, positions] = await Promise.all([
      prisma.employee.findMany({
        select: { id: true, companyId: true, department: true, jobTitle: true, orgUnitId: true, positionId: true },
      }),
      prisma.user.findMany({
        select: { id: true, email: true, role: true, _count: { select: { assignments: true } } },
      }),
      prisma.asset.findMany({ select: { id: true, companyId: true } }),
      existing ? prisma.orgUnit.findMany({ where: { companyId: existing.id }, select: { id: true, code: true } }) : [],
      existing ? prisma.position.findMany({ where: { companyId: existing.id }, select: { id: true, code: true } }) : [],
    ]);

    const plan = planMapping({
      companyId,
      employees,
      users: users.map((u) => ({ id: u.id, email: u.email, role: u.role, assignmentCount: u._count.assignments })),
      assets,
      roles,
      existingUnits: Object.fromEntries(units.map((u) => [u.code, u.id])),
      existingPositions: Object.fromEntries(positions.map((p) => [p.code, p.id])),
    });

    const report = {
      mode: apply ? 'apply' : 'dry-run',
      at: new Date().toISOString(),
      company: existing ? { id: existing.id, code, reused: true } : { code, nameAr, nameEn, reused: false },
      counts: {
        employeesToAssign: plan.employeesToAssign.length,
        assetsToAssign: plan.assetsToAssign.length,
        unitsToCreate: plan.unitsToCreate.length,
        positionsToCreate: plan.positionsToCreate.length,
        employeesLinkedToUnit: Object.keys(plan.employeeUnit).length,
        employeesLinkedToPosition: Object.keys(plan.employeePosition).length,
        userAssignments: plan.assignments.length,
      },
      unitsToCreate: plan.unitsToCreate,
      positionsToCreate: plan.positionsToCreate,
      assignments: plan.assignments.map((a) => ({
        user: users.find((u) => u.id === a.userId)?.email,
        role: a.roleCode,
        scope: a.global ? 'global' : code,
      })),
      review: plan.review,
    };
    console.log(JSON.stringify(report, null, 2));

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to perform the mapping.');
      return;
    }

    await prisma.$transaction(async (tx) => {
      const company =
        existing ??
        (await tx.company.create({ data: { code, nameAr, nameEn } }));

      const unitIds = Object.fromEntries(units.map((u) => [u.code, u.id]));
      for (const u of plan.unitsToCreate) {
        const row = await tx.orgUnit.create({
          data: {
            companyId: company.id,
            type: 'DEPARTMENT',
            code: u.code,
            nameAr: u.name,
            nameEn: u.name,
            path: '', // set below once the id is known
            depth: 0,
          },
        });
        await tx.orgUnit.update({ where: { id: row.id }, data: { path: `/${row.id}/` } });
        unitIds[u.code] = row.id;
      }
      const positionIds = Object.fromEntries(positions.map((p) => [p.code, p.id]));
      for (const p of plan.positionsToCreate) {
        const row = await tx.position.create({
          data: { companyId: company.id, code: p.code, titleAr: p.title, titleEn: p.title },
        });
        positionIds[p.code] = row.id;
      }

      if (plan.employeesToAssign.length) {
        await tx.employee.updateMany({
          where: { id: { in: plan.employeesToAssign } },
          data: { companyId: company.id },
        });
      }
      for (const [employeeId, unitCode] of Object.entries(plan.employeeUnit)) {
        await tx.employee.update({ where: { id: employeeId }, data: { orgUnitId: unitIds[unitCode] } });
      }
      for (const [employeeId, posCode] of Object.entries(plan.employeePosition)) {
        await tx.employee.update({ where: { id: employeeId }, data: { positionId: positionIds[posCode] } });
      }
      if (plan.assetsToAssign.length) {
        await tx.asset.updateMany({ where: { id: { in: plan.assetsToAssign } }, data: { companyId: company.id } });
      }

      const roleId = Object.fromEntries(roles.map((r) => [r.code, r.id]));
      for (const a of plan.assignments) {
        await tx.userAssignment.create({
          data: {
            userId: a.userId,
            roleId: roleId[a.roleCode] as string,
            companyId: a.global ? null : company.id,
          },
        });
      }
      // Single-company users land in their workspace on next login; super
      // admins choose explicitly.
      await tx.user.updateMany({
        where: { id: { in: plan.assignments.filter((a) => !a.global).map((a) => a.userId) } },
        data: { activeCompanyId: company.id },
      });

      await tx.auditLog.create({
        data: {
          entity: 'COMPANY',
          entityId: company.id,
          action: 'LEGACY_MAPPING',
          actorType: 'SYSTEM',
          companyId: company.id,
          metadata: report.counts,
        },
      });
    });

    const dir = join(process.cwd(), 'storage', 'migration-reports');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `multi-company-${report.at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\nAPPLIED. Report saved to ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly (tests import planMapping).
if (process.argv[1] && /migrate-multi-company\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
