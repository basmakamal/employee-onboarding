import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { logger } from '../../common/logger.js';
import { storagePath } from '../../common/storage.js';
import { fieldCrypto, maskIban } from '../../common/field-crypto.js';
import { localDay } from '../employees/employment-history.service.js';
import type { NotificationService } from '../../notifications/notification.service.js';
import type { CompensationService } from './compensation.service.js';
import { renderPayslip, type PayslipRow } from './payslip-pdf.js';

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const monthLabel = (m: string, locale: 'ar' | 'en') =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

export interface SendInput {
  /** Everyone in the run, one branch / department (and the units under it), or one employee. */
  scope: 'ALL' | 'UNIT' | 'EMPLOYEE';
  orgUnitId?: string | undefined;
  employeeId?: string | undefined;
  /** Send again to people who already received it. */
  resend?: boolean | undefined;
}

/**
 * Payslips: the PDF of each paid line of an approved run (generated once,
 * stored privately with a content hash), downloads, and e-mail delivery —
 * to a whole run, one department or one employee, by hand or automatically
 * on a chosen day of the month. A delivery key makes every send happen once.
 */
export class PayslipService {
  private lastAutoRun = '';

  constructor(
    private readonly db: PrismaClient,
    private readonly pay: CompensationService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLogRepository,
  ) {}

  private log(companyId: string, actor: Actor, entity: string, entityId: string, action: string, metadata: Record<string, string | number | boolean | null>, employeeId?: string) {
    return this.audit.append({
      entity, entityId, action, actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      ...(employeeId ? { employeeId } : {}),
      companyId, metadata,
    });
  }

  private async openRun(companyId: string, runId: string) {
    const run = await this.db.payrollRun.findFirst({ where: { id: runId, companyId } });
    if (!run) throw new NotFoundError('payroll run', runId);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw new GuardFailedError('NOT_APPROVED', 'payslips exist once the run is approved');
    return run;
  }

  // ─────────────────────────────────────────────────────────── generating

  /** The payslip of a line — rendered and stored the first time, the same file afterwards. */
  async ensure(companyId: string, lineId: string, actor: Actor | null) {
    const existing = await this.db.payslip.findUnique({ where: { lineId } });
    if (existing) return existing;
    const line = await this.db.payrollLine.findFirst({
      where: { id: lineId, run: { companyId } },
      include: {
        run: true,
        items: { orderBy: { sortOrder: 'asc' } },
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeNo: true, iban: true,
            orgUnit: { select: { nameAr: true, nameEn: true } },
            position: { select: { titleAr: true, titleEn: true } },
            company: { select: { nameAr: true, nameEn: true } },
          },
        },
      },
    });
    if (!line) throw new NotFoundError('payroll line', lineId);
    if (line.run.status !== 'APPROVED' && line.run.status !== 'PAID') throw new GuardFailedError('NOT_APPROVED', 'payslips exist once the run is approved');
    if (line.held) throw new GuardFailedError('LINE_HELD', 'this person was held out of the run — no payslip');
    const e = line.employee;
    const policy = await this.pay.policyOn(companyId, `${line.run.month}-01`);
    const row = (i: (typeof line.items)[number]): PayslipRow => ({
      labelAr: i.labelAr,
      labelEn: i.labelEn,
      amount: num(i.amount),
      detail:
        i.source === 'OVERTIME' && i.quantity != null && i.rate != null ? `${num(i.quantity)} h × ${num(i.rate).toFixed(2)}`
        : (i.source === 'ABSENCE' || i.source === 'LEAVE') && i.quantity != null ? `${num(i.quantity)} d`
        : i.source === 'LATE' && i.quantity != null ? `${num(i.quantity)} min`
        : i.source === 'GOSI' && i.rate != null ? `${num(i.rate)}%`
        : null,
    });
    const reference = `PS-${line.run.month}-${e.employeeNo ?? e.id.slice(-6)}`;
    const pdf = await renderPayslip({
      company: { nameAr: e.company?.nameAr ?? '', nameEn: e.company?.nameEn ?? '' },
      month: line.run.month,
      periodFrom: line.run.periodFrom.toISOString().slice(0, 10),
      periodTo: line.run.periodTo.toISOString().slice(0, 10),
      payDate: line.run.paidAt ? line.run.paidAt.toISOString().slice(0, 10) : `${line.run.month}-${String(policy.payDay).padStart(2, '0')}`,
      employee: {
        name: `${e.firstName} ${e.lastName}`.trim(),
        employeeNo: e.employeeNo,
        department: e.orgUnit ? { ar: e.orgUnit.nameAr, en: e.orgUnit.nameEn } : null,
        position: e.position ? { ar: e.position.titleAr, en: e.position.titleEn } : null,
        iban: maskIban(fieldCrypto().decrypt(e.iban)),
      },
      earnings: line.items.filter((i) => i.kind === 'EARNING').map(row),
      deductions: line.items.filter((i) => i.kind === 'DEDUCTION').map(row),
      gross: num(line.gross),
      totalDeductions: num(line.deductions),
      net: num(line.net),
      currency: policy.currency,
      generatedAt: new Date(),
      reference,
    });
    const storageKey = `payslips/${companyId}/${line.run.month}/${line.id}.pdf`;
    const abs = storagePath(storageKey);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, pdf);
    try {
      return await this.db.payslip.create({
        data: {
          companyId, lineId, runId: line.runId, employeeId: e.id, month: line.run.month, storageKey,
          sha256: createHash('sha256').update(pdf).digest('hex'), sizeBytes: pdf.length, generatedById: actor?.id ?? null,
        },
      });
    } catch (err) {
      // Generated twice at once: the first one stands.
      if ((err as { code?: string }).code === 'P2002') return this.db.payslip.findUniqueOrThrow({ where: { lineId } });
      throw err;
    }
  }

  /** A payslip to download — audited, since it carries pay. */
  async download(companyId: string, lineId: string, actor: Actor, expect: { runId?: string; employeeId?: string } = {}) {
    // The line must belong to the run / employee in the address, not just to the company.
    const line = await this.db.payrollLine.findFirst({
      where: { id: lineId, run: { companyId }, ...(expect.runId ? { runId: expect.runId } : {}), ...(expect.employeeId ? { employeeId: expect.employeeId } : {}) },
      select: { id: true },
    });
    if (!line) throw new NotFoundError('payslip', lineId);
    const slip = await this.ensure(companyId, lineId, actor);
    const e = await this.db.employee.findUnique({ where: { id: slip.employeeId }, select: { employeeNo: true } });
    await this.log(companyId, actor, 'EMPLOYEE', slip.employeeId, 'PAYSLIP_DOWNLOADED', { month: slip.month }, slip.employeeId);
    return { path: storagePath(slip.storageKey), filename: `payslip-${slip.month}-${e?.employeeNo ?? slip.employeeId}.pdf` };
  }

  // ─────────────────────────────────────────────────────────── sending

  /**
   * Send the payslips of a run to the chosen people. The rows to send are
   * worked out now; generating and handing them to the mail queue happens in
   * the background (or right away with `wait`), so a large run returns at once.
   */
  async send(companyId: string, runId: string, input: SendInput, actor: Actor, opts: { trigger?: 'MANUAL' | 'SCHEDULED'; wait?: boolean } = {}) {
    const run = await this.openRun(companyId, runId);
    const where: Prisma.PayrollLineWhereInput = { runId, held: false };
    if (input.scope === 'EMPLOYEE') {
      if (!input.employeeId) throw new GuardFailedError('EMPLOYEE_REQUIRED', 'pick the employee', 'employeeId');
      where.employeeId = input.employeeId;
    } else if (input.scope === 'UNIT') {
      const unit = input.orgUnitId ? await this.db.orgUnit.findFirst({ where: { id: input.orgUnitId, companyId }, select: { path: true } }) : null;
      if (!unit) throw new GuardFailedError('BAD_ORG_UNIT', 'pick a branch or department of this company', 'orgUnitId');
      where.employee = { orgUnit: { path: { startsWith: unit.path } } };
    }
    const lines = await this.db.payrollLine.findMany({ where, select: { id: true, employeeId: true, payslip: { select: { deliveries: { where: { status: { in: ['QUEUED', 'SENT'] } }, select: { id: true } } } } } });
    // Already sent (or on its way) is skipped, unless sending again was asked for.
    const todo = input.resend ? lines : lines.filter((l) => !l.payslip?.deliveries.length);
    const work = this.deliver(companyId, run.month, todo.map((l) => l.id), actor, opts.trigger ?? 'MANUAL', !!input.resend);
    if (opts.wait) await work;
    else void work.catch((err: unknown) => logger.error({ err, runId }, 'payslip sending failed'));
    await this.log(companyId, actor, 'PAYROLL_RUN', runId, 'PAYSLIPS_SENT', { scope: input.scope, count: todo.length, resend: !!input.resend, trigger: opts.trigger ?? 'MANUAL' });
    return { count: todo.length, skipped: lines.length - todo.length };
  }

  private async deliver(companyId: string, month: string, lineIds: string[], actor: Actor, trigger: 'MANUAL' | 'SCHEDULED', resend: boolean) {
    for (const lineId of lineIds) {
      try {
        const slip = await this.ensure(companyId, lineId, actor);
        const e = await this.db.employee.findUnique({ where: { id: slip.employeeId }, select: { email: true, firstName: true, lastName: true, employeeNo: true, preferredLanguage: true } });
        const email = e?.email?.trim() || null;
        const key = `${slip.id}:${email ?? 'none'}${resend ? `:resend:${Date.now()}` : ''}`;
        let delivery;
        try {
          delivery = await this.db.payslipDelivery.create({
            data: { payslipId: slip.id, email, status: email ? 'QUEUED' : 'NO_EMAIL', trigger, deliveryKey: key, requestedById: actor.id ?? null },
          });
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002') continue; // sent already
          throw err;
        }
        if (!email) continue;
        const locale = e?.preferredLanguage === 'EN' ? 'en' : 'ar';
        try {
          const sent = await this.notifications.sendDocument(
            email,
            'employee.payslip',
            { name: `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim(), ...(e?.employeeNo ? { employeeNo: e.employeeNo } : {}), payMonth: monthLabel(month, locale) },
            { filename: `payslip-${month}-${e?.employeeNo ?? slip.employeeId}.pdf`, storageKey: slip.storageKey, contentType: 'application/pdf' },
            { entity: 'EMPLOYEE', entityId: slip.employeeId, companyId },
            locale,
          );
          await this.db.payslipDelivery.update({ where: { id: delivery.id }, data: { notificationId: sent.id } });
        } catch (err) {
          await this.db.payslipDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', error: String((err as Error).message ?? err).slice(0, 500) } });
        }
      } catch (err) {
        logger.error({ err, lineId }, 'payslip could not be prepared');
      }
    }
  }

  // ─────────────────────────────────────────────────────────── reading

  /** Each paid line of a run with its payslip and the latest delivery (status from the e-mail log). */
  async forRun(companyId: string, runId: string) {
    await this.openRun(companyId, runId);
    const lines = await this.db.payrollLine.findMany({
      where: { runId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, email: true, orgUnit: { select: { id: true, nameAr: true, nameEn: true } } } },
        payslip: { include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
      orderBy: { employee: { firstName: 'asc' } },
    });
    const notificationIds = lines.flatMap((l) => l.payslip?.deliveries.map((d) => d.notificationId) ?? []).filter((x): x is string => !!x);
    const notes = notificationIds.length ? await this.db.notification.findMany({ where: { id: { in: notificationIds } }, select: { id: true, status: true, sentAt: true } }) : [];
    return lines.map((l) => {
      const d = l.payslip?.deliveries[0] ?? null;
      const n = d?.notificationId ? notes.find((x) => x.id === d.notificationId) : null;
      return {
        lineId: l.id,
        held: l.held,
        employee: l.employee,
        net: num(l.net),
        payslip: l.payslip ? { id: l.payslip.id, generatedAt: l.payslip.generatedAt, sizeBytes: l.payslip.sizeBytes } : null,
        delivery: d
          ? {
              email: d.email,
              trigger: d.trigger,
              createdAt: d.createdAt,
              // The e-mail log knows whether the mail server took it.
              status: d.status === 'QUEUED' && n ? (n.status === 'SENT' ? 'SENT' : n.status === 'FAILED' ? 'FAILED' : 'QUEUED') : d.status,
              sentAt: n?.sentAt ?? d.sentAt,
            }
          : null,
      };
    });
  }

  /** An employee's payslips (Pay tab). */
  async forEmployee(companyId: string, employeeId: string) {
    const lines = await this.db.payrollLine.findMany({
      where: { employeeId, held: false, run: { companyId, status: { in: ['APPROVED', 'PAID'] } } },
      include: { run: { select: { month: true, status: true } }, payslip: { include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
      orderBy: { run: { month: 'desc' } },
      take: 36,
    });
    return lines.map((l) => ({
      lineId: l.id,
      month: l.run.month,
      net: num(l.net),
      gross: num(l.gross),
      sentAt: l.payslip?.deliveries[0]?.createdAt ?? null,
      sentTo: l.payslip?.deliveries[0]?.email ?? null,
    }));
  }

  // ─────────────────────────────────────────────────────────── schedule

  async settings(companyId: string) {
    return (await this.db.payslipSetting.findUnique({ where: { companyId } })) ?? { companyId, autoSend: false, sendDay: 27, lastAutoMonth: null };
  }

  async saveSettings(companyId: string, input: { autoSend: boolean; sendDay: number }, actor: Actor) {
    if (input.sendDay < 1 || input.sendDay > 28) throw new GuardFailedError('BAD_DAY', 'a day from 1 to 28', 'sendDay');
    const row = await this.db.payslipSetting.upsert({
      where: { companyId },
      create: { companyId, autoSend: input.autoSend, sendDay: input.sendDay, updatedById: actor.id ?? null },
      update: { autoSend: input.autoSend, sendDay: input.sendDay, updatedById: actor.id ?? null },
    });
    await this.log(companyId, actor, 'PAYSLIP_SETTING', row.id, 'PAYSLIP_SCHEDULE_SAVED', { autoSend: input.autoSend, sendDay: input.sendDay });
    return row;
  }

  /**
   * The scheduler's job (hourly): on the chosen day — or the first run after
   * it — e-mail this month's approved run to everyone not sent yet, once.
   * A run approved later in the month is picked up the next hour.
   */
  async autoSend(now = new Date()): Promise<number> {
    const hour = now.toISOString().slice(0, 13);
    if (hour === this.lastAutoRun) return 0;
    this.lastAutoRun = hour;
    let total = 0;
    const settings = await this.db.payslipSetting.findMany({ where: { autoSend: true }, include: { company: { select: { timezone: true } } } });
    for (const s of settings) {
      try {
        const today = localDay(s.company.timezone ?? 'Asia/Riyadh', now);
        const month = today.slice(0, 7);
        if (Number(today.slice(8, 10)) < s.sendDay || s.lastAutoMonth === month) continue;
        const run = await this.db.payrollRun.findFirst({ where: { companyId: s.companyId, month, status: { in: ['APPROVED', 'PAID'] } }, orderBy: { version: 'desc' } });
        if (!run) continue;
        const r = await this.send(s.companyId, run.id, { scope: 'ALL' }, { type: 'SYSTEM' }, { trigger: 'SCHEDULED', wait: true });
        await this.db.payslipSetting.update({ where: { id: s.id }, data: { lastAutoMonth: month } });
        total += r.count;
      } catch (err) {
        logger.error({ err, companyId: s.companyId }, 'automatic payslip sending failed');
      }
    }
    return total;
  }
}
