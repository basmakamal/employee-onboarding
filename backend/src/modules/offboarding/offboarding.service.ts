import type { Actor, OwnershipLookup } from '../../workflow/engine.js';
import { Workflow } from '../../workflow/engine.js';
import { offboardingMachine } from '../../workflow/machines/offboarding.machine.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { Offboarding, Prisma } from '../../generated/prisma/client.js';
import type { OffboardingReason, OffboardingStatus } from '../../generated/prisma/enums.js';
import type { UnitOfWork } from '../../common/prisma.js';
import type { OffboardingRepository } from './offboarding.repository.js';
import type { EmployeeRepository } from '../employees/employee.repository.js';
import type { AssetFormRepository } from '../assets/asset-form.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';
import type { NotificationService } from '../../notifications/notification.service.js';

interface ExitLinkRow {
  id: string;
  purpose: string;
  offboardingId: string | null;
}

/** One offboarding unit of work — everything shares one transaction. */
export interface OffboardingTxScope {
  offboardings: OffboardingRepository;
  employees: EmployeeRepository;
  assetForms: AssetFormRepository;
  audit: AuditLogRepository;
  /** Single-use stamp for the link consumed by this unit of work. */
  markLinkUsed: (tokenId: string, at: Date) => Promise<unknown>;
}

/**
 * Stage 3 — Offboarding (إنهاء العلاقة التعاقدية). One record walks:
 * REQUESTED → IN_PROGRESS (exit interview auto-sent for resignations) →
 * ASSETS_PENDING (hard gate: every approved custody item returned) →
 * NOTICE_SENT → SETTLEMENT (HR enters amounts) → CLOSED (FINANCE approves;
 * the employee flips to INACTIVE and the file is closed).
 *
 * Each step's transition, audit row and timestamp stamps commit together;
 * emails and link issuance stay outside the transaction.
 */
export class OffboardingService {
  private readonly machine;
  /** Root-bound instance for read-only lookups (availableActions). */
  private readonly readWorkflow: Workflow<Offboarding>;

  constructor(
    private readonly repos: {
      offboardings: OffboardingRepository;
      employees: EmployeeRepository;
      assetForms: AssetFormRepository;
      audit: AuditLogRepository;
    },
    private readonly links: LinkTokenService,
    private readonly notifications: NotificationService,
    private readonly transact: UnitOfWork<OffboardingTxScope>,
    private readonly ownership?: OwnershipLookup,
  ) {
    // The asset gate reads through the root client — a pre-check, like all
    // machine guards, so it doesn't need the transaction.
    this.machine = offboardingMachine({
      countUnreturnedAssets: (employeeId) => repos.assetForms.countUnreturnedItems(employeeId),
    });
    this.readWorkflow = this.workflowFor({
      offboardings: repos.offboardings,
      employees: repos.employees,
      assetForms: repos.assetForms,
      audit: repos.audit,
      markLinkUsed: () => Promise.resolve({}),
    });
  }

  /** The machine bound to one unit of work's repositories. */
  private workflowFor(s: OffboardingTxScope): Workflow<Offboarding> {
    return new Workflow<Offboarding>(this.machine, {
      getId: (o) => o.id,
      getStatus: (o) => o.status,
      ...(this.ownership ? { ownership: this.ownership } : {}),
      move: (o, from, to) =>
        s.offboardings.moveStatus(o.id, from as OffboardingStatus, to as OffboardingStatus),
      audit: (entry) => s.audit.append(entry),
      anchors: (o) => ({ employeeId: o.employeeId }),
    });
  }

  // ------------------------------------------------------------- HR flow

  async create(
    employeeId: string,
    reason: OffboardingReason,
    actor: Actor,
    notes?: string,
  ) {
    const employee = await this.repos.employees.findById(employeeId);
    if (!employee) throw new NotFoundError('employee', employeeId);
    if (employee.status !== 'ACTIVE') {
      throw new GuardFailedError('EMPLOYEE_INACTIVE', 'the employee is not active');
    }
    if (await this.repos.offboardings.findOpenByEmployee(employeeId)) {
      throw new GuardFailedError('ALREADY_OPEN', 'an offboarding is already in progress');
    }

    return this.transact(async (s) => {
      const offboarding = await s.offboardings.create({
        employeeId,
        reason,
        requestedById: actor.id ?? '',
        ...(notes ? { notes } : {}),
      });
      await s.audit.append({
        entity: 'OFFBOARDING',
        entityId: offboarding.id,
        action: 'CREATE',
        toStatus: offboarding.status,
        actorType: actor.type,
        ...(actor.id ? { actorId: actor.id } : {}),
        employeeId,
        metadata: { reason },
      });
      return offboarding;
    });
  }

  async get(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    const employee = await this.repos.employees.findById(offboarding.employeeId);
    const forms = await this.repos.assetForms.listByEmployee(offboarding.employeeId);
    const approvedItems = forms
      .filter((f) => f.status === 'APPROVED')
      .flatMap((f) => f.items.map((i) => ({ ...i, formId: f.id })));

    return {
      ...offboarding,
      employee,
      availableActions: this.readWorkflow.availableActions(offboarding.status, actor),
      assets: {
        items: approvedItems,
        unreturned: approvedItems.filter((i) => i.returnedAt === null).length,
      },
    };
  }

  /** START: procedures begin; resignations auto-receive the exit interview. */
  async start(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    const result = await this.transact((s) =>
      this.workflowFor(s).transition(offboarding, 'START', actor),
    );
    let exitInterviewUrl: string | undefined;

    if (offboarding.reason === 'RESIGNATION') {
      const employee = await this.repos.employees.findById(offboarding.employeeId);
      if (employee) {
        const link = await this.links.issue('EXIT_INTERVIEW', {
          employeeId: employee.id,
          offboardingId: id,
        });
        await this.notifications.notifyExternal(
          employee.email,
          'employee.exit_interview',
          { name: `${employee.firstName} ${employee.lastName}`, linkUrl: link.url },
          { entity: 'OFFBOARDING', entityId: id },
        );
        await this.transact(async (s) => {
          await this.stamp(s, id, 'IN_PROGRESS', { exitInterviewSentAt: new Date() });
          await s.audit.append({
            entity: 'OFFBOARDING',
            entityId: id,
            action: 'LINK_SENT',
            actorType: 'SYSTEM',
            employeeId: offboarding.employeeId,
            metadata: { purpose: 'EXIT_INTERVIEW' },
          });
        });
        exitInterviewUrl = link.url;
      }
    }
    return { ...result, ...(exitInterviewUrl ? { exitInterviewUrl } : {}) };
  }

  async toAssetReturn(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    return this.transact((s) =>
      this.workflowFor(s).transition(offboarding, 'TO_ASSET_RETURN', actor),
    );
  }

  /** HR records each custody item as physically returned. */
  async markItemReturned(offboardingId: string, itemId: string, actor: Actor) {
    const offboarding = await this.mustFind(offboardingId);
    return this.transact(async (s) => {
      const item = await s.assetForms.markItemReturned(itemId, new Date());
      await s.audit.append({
        entity: 'OFFBOARDING',
        entityId: offboardingId,
        action: 'ASSET_RETURNED',
        actorType: actor.type,
        ...(actor.id ? { actorId: actor.id } : {}),
        employeeId: offboarding.employeeId,
        metadata: { itemId, type: item.type, name: item.name },
      });
      return item;
    });
  }

  /** BRD hard gate + official notice in one confirmed step. */
  async confirmAssetsReturned(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    const now = new Date();
    const result = await this.transact(async (s) => {
      const r = await this.workflowFor(s).transition(offboarding, 'CONFIRM_ASSETS_RETURNED', actor);
      await this.stamp(s, id, 'NOTICE_SENT', {
        assetsConfirmedAt: now,
        ...(actor.id ? { assetsConfirmedById: actor.id } : {}),
        noticeSentAt: now,
      });
      return r;
    });

    const employee = await this.repos.employees.findById(offboarding.employeeId);
    if (employee) {
      await this.notifications.notifyExternal(
        employee.email,
        'employee.termination_notice',
        { name: `${employee.firstName} ${employee.lastName}` },
        { entity: 'OFFBOARDING', entityId: id },
      );
    }
    return result;
  }

  async toSettlement(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    return this.transact((s) =>
      this.workflowFor(s).transition(offboarding, 'TO_SETTLEMENT', actor),
    );
  }

  /** HR (or finance) enters the settlement amounts — closure stays FINANCE. */
  async recordSettlement(
    id: string,
    amounts: {
      workingDays: number;
      leaveDays: number;
      deductions: number;
      entitlements: number;
      notes?: string;
    },
    actor: Actor,
  ) {
    const offboarding = await this.mustFind(id);
    if (offboarding.status !== 'SETTLEMENT') {
      throw new GuardFailedError('WRONG_STATUS', 'the record is not in the settlement stage');
    }
    await this.transact(async (s) => {
      await s.offboardings.recordSettlement(id, {
        settlementWorkingDays: amounts.workingDays,
        settlementLeaveDays: amounts.leaveDays,
        settlementDeductions: amounts.deductions,
        settlementEntitlements: amounts.entitlements,
        ...(amounts.notes ? { settlementNotes: amounts.notes } : {}),
      });
      await s.audit.append({
        entity: 'OFFBOARDING',
        entityId: id,
        action: 'SETTLEMENT_RECORDED',
        actorType: actor.type,
        ...(actor.id ? { actorId: actor.id } : {}),
        employeeId: offboarding.employeeId,
        metadata: amounts,
      });
    });
    return this.mustFind(id);
  }

  /**
   * FINANCE approves & pays → file closed, employee INACTIVE (BRD step 5).
   * The close transition, its stamps and the employee flip are ONE
   * transaction — the file can never end up closed with the employee
   * still marked active.
   */
  async close(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    const now = new Date();
    return this.transact(async (s) => {
      const result = await this.workflowFor(s).transition(offboarding, 'CLOSE', actor);

      await this.stamp(s, id, 'CLOSED', {
        closedAt: now,
        settlementApprovedAt: now,
        ...(actor.id ? { settlementApprovedById: actor.id } : {}),
      });

      const flipped = await s.employees.moveStatus(offboarding.employeeId, 'ACTIVE', 'INACTIVE');
      if (flipped) {
        await s.audit.append({
          entity: 'EMPLOYEE',
          entityId: offboarding.employeeId,
          action: 'STATUS_TRANSITION',
          fromStatus: 'ACTIVE',
          toStatus: 'INACTIVE',
          actorType: 'SYSTEM',
          employeeId: offboarding.employeeId,
          metadata: { offboardingId: id },
        });
      }
      return result;
    });
  }

  async cancel(id: string, actor: Actor) {
    const offboarding = await this.mustFind(id);
    return this.transact((s) => this.workflowFor(s).transition(offboarding, 'CANCEL', actor));
  }

  // ------------------------------------------------------- signed-link side

  async buildLinkContext(row: ExitLinkRow) {
    if (!row.offboardingId) throw new NotFoundError('link', 'no offboarding attached');
    const offboarding = await this.mustFind(row.offboardingId);
    const employee = await this.repos.employees.findById(offboarding.employeeId);
    return {
      purpose: 'EXIT_INTERVIEW' as const,
      employee: employee
        ? { firstName: employee.firstName, lastName: employee.lastName }
        : { firstName: '', lastName: '' },
      completed: offboarding.exitInterviewCompletedAt !== null,
    };
  }

  async submitExitInterview(rawToken: string, answers: Prisma.InputJsonValue) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'EXIT_INTERVIEW' || !token.offboardingId) {
      throw new NotFoundError('link', 'not an exit-interview link');
    }
    const offboarding = await this.mustFind(token.offboardingId);

    const now = new Date();
    await this.transact(async (s) => {
      await s.offboardings.recordExitInterview(offboarding.id, answers, now);
      await s.markLinkUsed(token.id, now);
      await s.audit.append({
        entity: 'OFFBOARDING',
        entityId: offboarding.id,
        action: 'EXIT_INTERVIEW_SUBMITTED',
        actorType: 'LINK',
        employeeId: offboarding.employeeId,
      });
    });

    const employee = await this.repos.employees.findById(offboarding.employeeId);
    if (employee) {
      await this.notifications.notifyHr(
        'hr.exit_interview_done',
        { name: `${employee.firstName} ${employee.lastName}` },
        { entity: 'OFFBOARDING', entityId: offboarding.id },
      );
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ private

  private async mustFind(id: string) {
    const offboarding = await this.repos.offboardings.findById(id);
    if (!offboarding) throw new NotFoundError('offboarding', id);
    return offboarding;
  }

  /** Post-transition field stamping (same-status guarded write). */
  private stamp(
    s: OffboardingTxScope,
    id: string,
    status: OffboardingStatus,
    fields: Prisma.OffboardingUpdateManyMutationInput,
  ) {
    return s.offboardings.moveStatus(id, status, status, fields);
  }
}
