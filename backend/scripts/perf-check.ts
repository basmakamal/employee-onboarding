/**
 * Speed check with realistic volumes — run before a release, never on real data.
 *
 *   DATABASE_URL=mysql://…/employee_onboarding_perf npx tsx scripts/perf-check.ts [employees]
 *
 * Fills a throw-away database (its name must end in "_perf") with two
 * companies: A with N employees (default 1000) on a Sunday–Thursday shift,
 * a salary each and a full month of punches; B with a handful, to check
 * that A's work never reaches B. Then times what HR does at month end:
 * judge the attendance, open the registers, calculate payroll, render
 * payslips and build the reports. Nothing is e-mailed.
 *
 * Each run adds two new companies; for a clean slate first run
 *   npx prisma migrate reset --force && npx prisma db seed   (same DATABASE_URL — the _perf database only)
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config } from '../src/common/config.js';
import { buildContainer } from '../src/container.js';
import type { Actor } from '../src/workflow/engine.js';

const dbName = new URL(config.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_perf')) {
  console.error(`refusing to run on "${dbName}" — the speed check only fills a database whose name ends in _perf`);
  process.exit(1);
}

const N = Number(process.argv[2] ?? 1000);
const MONTH = '2026-09';
const FROM = `${MONTH}-01`;
const TO = `${MONTH}-30`;
const PDF_SAMPLE = 40;

const c = buildContainer();
const db = c.prisma;
const results: Array<{ step: string; ms: number; note: string }> = [];

async function timed<T>(step: string, fn: () => Promise<T>, note: (r: T) => string = () => ''): Promise<T> {
  const t = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t);
  results.push({ step, ms, note: note(r) });
  console.log(`${step.padEnd(44)} ${String(ms).padStart(7)} ms  ${note(r)}`);
  return r;
}

async function chunked<T>(rows: T[], size: number, write: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

/** Local Riyadh time (UTC+3, no daylight saving) → instant. */
const riyadh = (day: string, minutes: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (minutes - 180) * 60_000);

async function company(code: string, people: number, actor: Actor) {
  const co = await db.company.create({ data: { code, nameAr: `شركة ${code}`, nameEn: `Company ${code}` } });
  const companyId = co.id;

  const branches = Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), code: `${code}-BR${i + 1}`, n: i + 1 }));
  await db.orgUnit.createMany({
    data: branches.map((b) => ({ id: b.id, companyId, type: 'BRANCH', code: b.code, nameAr: `فرع ${b.n}`, nameEn: `Branch ${b.n}`, path: `/${b.id}/` })),
  });

  const shift = await c.scheduleService.createShift(companyId, { code: 'DAY', nameAr: 'صباحي', nameEn: 'Day', startTime: '08:00', endTime: '16:00', breakMinutes: 60, graceMinutes: 10 }, actor);
  const pattern = await c.scheduleService.createPattern(
    companyId,
    { code: 'SUN-THU', nameAr: 'الأحد–الخميس', nameEn: 'Sun–Thu', kind: 'WEEKLY', cycleDays: 7, days: [[shift.id], [shift.id], [shift.id], [shift.id], [shift.id], [], []] },
    actor,
  );
  const components = await c.compensationService.listComponents(companyId);
  const comp = (code: string) => components.find((x) => x.code === code)!.id;

  const employees = Array.from({ length: people }, (_, i) => ({
    id: randomUUID(),
    companyId,
    employeeNo: `${code}-${String(i + 1).padStart(5, '0')}`,
    firstName: `موظف${i + 1}`,
    lastName: code,
    email: `perf.${code.toLowerCase()}.${i + 1}@example.test`,
    status: 'ACTIVE' as const,
    hireDate: new Date(Date.UTC(2025, 0, 1)),
    nationality: i % 3 === 0 ? 'EG' : 'SA',
    orgUnitId: branches[i % branches.length]!.id,
  }));
  await chunked(employees, 1000, (part) => db.employee.createMany({ data: part }));
  await chunked(employees, 1000, (part) =>
    db.shiftAssignment.createMany({ data: part.map((e) => ({ companyId, employeeId: e.id, patternId: pattern.id, startDate: new Date(Date.UTC(2025, 0, 1)) })) }),
  );
  const pays = employees.map((e, i) => ({ id: randomUUID(), companyId, employeeId: e.id, effectiveFrom: new Date(Date.UTC(2025, 0, 1)), basic: 4000 + (i % 40) * 250 }));
  await chunked(pays, 1000, (part) => db.employeeCompensation.createMany({ data: part.map(({ basic: _b, ...p }) => p) }));
  await chunked(pays, 1000, (part) =>
    db.employeeCompensationLine.createMany({
      data: part.flatMap((p) => [
        { compensationId: p.id, componentId: comp('BASIC'), amount: p.basic },
        { compensationId: p.id, componentId: comp('HOUSING'), amount: Math.round(p.basic / 4) },
        { compensationId: p.id, componentId: comp('TRANSPORT'), amount: 500 },
      ]),
    }),
  );

  // A month of punches: Sunday–Thursday, a little lateness, a few absences and forgotten check-outs.
  const events: Array<{ companyId: string; employeeId: string; kind: string; at: Date; source: string; fingerprint: string }> = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (let d = 1; d <= 30; d++) {
    const day = `${MONTH}-${String(d).padStart(2, '0')}`;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday === 5 || weekday === 6) continue;
    for (const e of employees) {
      const r = rand();
      if (r < 0.02) continue; // absent
      const inAt = riyadh(day, 8 * 60 + Math.floor(rand() * 25) - 5);
      events.push({ companyId, employeeId: e.id, kind: 'IN', at: inAt, source: 'DEVICE', fingerprint: `${e.id}:IN:${inAt.toISOString()}` });
      if (r < 0.03) continue; // forgot to check out
      const outAt = riyadh(day, 16 * 60 + Math.floor(rand() * 70) - 10);
      events.push({ companyId, employeeId: e.id, kind: 'OUT', at: outAt, source: 'DEVICE', fingerprint: `${e.id}:OUT:${outAt.toISOString()}` });
    }
  }
  await chunked(events, 1000, (part) => db.attendanceEvent.createMany({ data: part }));
  return { companyId, employees, branches, events: events.length };
}

async function main() {
  const admin = await db.user.findFirst({ where: { email: 'admin@example.com' } });
  const hr = await db.user.findFirst({ where: { email: 'hr@example.com' } });
  if (!admin || !hr) throw new Error('run the seed on this database first (npx prisma db seed)');
  // HR prepares, the admin approves: the same person may not do both.
  const actor: Actor = { type: 'USER', role: 'ADMIN', id: admin.id };
  const hrActor: Actor = { type: 'USER', role: 'HR', id: hr.id };

  console.log(`database ${dbName}: filling company A with ${N} employees, company B with 20…`);
  const t0 = performance.now();
  const tag = Date.now().toString(36).toUpperCase(); // each run fills fresh companies; reset the database to start clean
  const A = await company(`A${tag}`, N, actor);
  const B = await company(`B${tag}`, 20, actor);
  console.log(`filled in ${Math.round(performance.now() - t0)} ms (${A.events} punches in A)\n`);

  const ids = A.employees.map((e) => e.id);
  const branchScope = { companyId: A.companyId, OR: [{ orgUnit: { path: { startsWith: `/${A.branches[0]!.id}/` } } }] };

  await timed(`judge attendance — ${N} people × 30 days`, () => c.attendanceService.recompute(A.companyId, ids, FROM, TO), (n) => `${n} days`);
  await timed('judge again (nothing changed)', () => c.attendanceService.recompute(A.companyId, ids, FROM, TO), (n) => `${n} days`);
  await timed('attendance register, page 1 (company)', () => c.attendanceService.listDays(A.companyId, undefined, { from: FROM, to: TO, page: 1, limit: 50 }), (r) => `${r.total} rows in all`);
  await timed('attendance register, waiting for review', () => c.attendanceService.listDays(A.companyId, undefined, { from: FROM, to: TO, review: 'PENDING', page: 1, limit: 50 }), (r) => `${r.total} waiting for review`);
  await timed('attendance register, one branch', () => c.attendanceService.listDays(A.companyId, branchScope, { from: FROM, to: TO, page: 1, limit: 50 }), (r) => `${r.total} rows`);
  await timed('attendance summary report', () => c.workforceReports.attendanceSummary(A.companyId, undefined, { from: FROM, to: TO }), (r) => `${r.rows.length} people`);
  await timed('leave report', () => c.workforceReports.leaveReport(A.companyId, undefined, { year: 2026 }), (r) => `${r.rows.length} rows`);

  // HR goes through the flagged days, 200 at a time like the register's bulk action.
  const pending = await db.attendanceDay.findMany({ where: { companyId: A.companyId, review: 'PENDING' }, select: { id: true } });
  await timed(`review ${pending.length} flagged days (200 per action)`, async () => {
    for (let i = 0; i < pending.length; i += 200) {
      await c.attendanceService.review(A.companyId, pending.slice(i, i + 200).map((d) => d.id), i % 400 === 0 ? 'CONFIRMED' : 'EXCUSED', 'perf check', hrActor, undefined);
    }
  });

  const run = await timed(`calculate payroll — ${N} people`, () => c.payrollService.calculateMonth(A.companyId, MONTH, hrActor), (r) => `net ${Number(r.net).toLocaleString('en')} SAR`);
  await timed('recalculate payroll', () => c.payrollService.recalculate(A.companyId, run.id, hrActor));
  const approved = await timed('approve payroll (locks the month)', () => c.payrollService.approve(A.companyId, run.id, undefined, actor), (r) => r.status);
  await timed('open the run (lines + comparison)', () => c.payrollService.get(A.companyId, run.id), (r) => `${r.lines.length} lines`);
  await timed('payroll register sheet', () => c.workforceReports.registerSheet(A.companyId, run.id), (s) => `${s.rows.length} rows × ${s.columns.length} columns`);
  await timed('variance against last month', () => c.workforceReports.variance(A.companyId, run.id), (v) => `${v.rows.length} rows`);
  await timed('payslips of the run (list)', () => c.payslipService.forRun(A.companyId, run.id), (r) => `${(r as { lines?: unknown[] }).lines?.length ?? ''}`);

  const lines = approved.lines.slice(0, PDF_SAMPLE); // recalculating replaced the lines of the first calculation
  const pdf = await timed(`render ${PDF_SAMPLE} payslip PDFs`, async () => {
    for (const l of lines) await c.payslipService.ensure(A.companyId, l.id, actor);
    return lines.length;
  });
  void pdf;
  const per = results.at(-1)!.ms / PDF_SAMPLE;
  console.log(`  → about ${Math.round(per)} ms each; all ${N} ≈ ${Math.round((per * N) / 1000)} s (they are rendered once, then kept)`);

  // B is untouched by everything above.
  const leaked = await db.attendanceDay.count({ where: { companyId: B.companyId } });
  const bRuns = await db.payrollRun.count({ where: { companyId: B.companyId } });
  const wrongCompany = await db.payrollLine.count({ where: { runId: run.id, employee: { companyId: { not: A.companyId } } } });
  console.log(`\ncompany B: ${leaked} attendance days, ${bRuns} payroll runs; lines of A's run outside A: ${wrongCompany}`);
  if (leaked || bRuns || wrongCompany) process.exitCode = 1;

  console.log('\nslowest steps:');
  for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  ${r.step}: ${r.ms} ms`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200));
