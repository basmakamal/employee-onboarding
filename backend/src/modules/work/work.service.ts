import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { OwnershipLookup } from '../../workflow/engine.js';
import type { SlaRuleRepository } from '../../workflow/sla-rule.repository.js';

/**
 * The unified work queue: every record the caller's role can act on right
 * now, ranked by how close it is to breaching its SLA.
 *
 * The web app has no equivalent — it navigates by entity. On a phone the
 * question is "what needs me today", which cuts across all six machines.
 *
 * Authority note: this decides what to SHOW. What a user may DO to a record
 * still comes from the state machine's `availableActions` on the detail
 * endpoint — this service never grants anything.
 */

const DAY_MS = 86_400_000;

export type WorkKind =
  | 'EMPLOYEE'
  | 'GOSI'
  | 'MEDICAL_INSURANCE'
  | 'CRIMINAL_RECORD'
  | 'ASSET_FORM'
  | 'OFFBOARDING';

export type Bucket = 'overdue' | 'today' | 'week' | 'later';

export interface WorkItem {
  kind: WorkKind;
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  status: string;
  /** Hold reason, offboarding reason — the "why is this stuck" line. */
  detail: string | null;
  since: Date;
  ageDays: number;
  /** Days until the first SLA rule fires; null when no rule watches this. */
  dueInDays: number | null;
  bucket: Bucket;
}

const fromStatuses = (statuses: string[], roles: Role[]): Record<string, Role[]> =>
  Object.fromEntries(statuses.map((s) => [s, roles]));

/**
 * Default owners per machine status, mirroring the roles the state machines
 * declare on their transitions. The StatusOwnership table overrides these at
 * runtime, exactly as it does for the engine.
 */
const OWNERS: Record<string, Record<string, Role[]>> = {
  EMPLOYEE: fromStatuses(
    ['CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL', 'EXPIRED'],
    ['HR'],
  ),
  GOSI: fromStatuses(['PENDING', 'ON_HOLD'], ['INSURANCE']),
  MEDICAL_INSURANCE: fromStatuses(['PENDING', 'ON_HOLD'], ['INSURANCE']),
  CRIMINAL_RECORD: fromStatuses(['TRAINING', 'REQUEST_SENT', 'PENDING'], ['HR']),
  ASSET_FORM: fromStatuses(['DRAFT', 'SENT', 'PENDING_EMPLOYEE_APPROVAL'], ['IT']),
  OFFBOARDING: {
    ...fromStatuses(['REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT'], ['HR']),
    SETTLEMENT: ['HR', 'FINANCE'],
  },
};

/** Bottom-nav destinations per role — the app builds its tab bar from this. */
const TABS: Record<Role, string[]> = {
  HR: ['home', 'work', 'directory', 'inbox', 'more'],
  ADMIN: ['home', 'work', 'directory', 'inbox', 'more'],
  INSURANCE: ['work', 'directory', 'inbox'],
  IT: ['work', 'directory', 'inbox'],
  FINANCE: ['work', 'inbox', 'more'],
};

type Access = 'none' | 'read' | 'write';

const MODULES: Record<Role, Record<string, Access>> = {
  HR: {
    employees: 'write', onboarding: 'write', processes: 'write', assets: 'read',
    offboarding: 'write', documents: 'write', reports: 'read', assistant: 'write', admin: 'none',
  },
  ADMIN: {
    employees: 'write', onboarding: 'write', processes: 'write', assets: 'write',
    offboarding: 'write', documents: 'write', reports: 'read', assistant: 'write', admin: 'write',
  },
  INSURANCE: {
    employees: 'read', onboarding: 'none', processes: 'write', assets: 'none',
    offboarding: 'none', documents: 'read', reports: 'none', assistant: 'none', admin: 'none',
  },
  IT: {
    employees: 'read', onboarding: 'none', processes: 'none', assets: 'write',
    offboarding: 'none', documents: 'read', reports: 'none', assistant: 'none', admin: 'none',
  },
  FINANCE: {
    employees: 'read', onboarding: 'none', processes: 'none', assets: 'none',
    offboarding: 'write', documents: 'read', reports: 'none', assistant: 'none', admin: 'none',
  },
};

export interface Capabilities {
  role: Role;
  tabs: string[];
  modules: Record<string, Access>;
  /** processKey → statuses this role owns, after ownership overrides. */
  ownership: Record<string, string[]>;
}

export class WorkService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ownership: OwnershipLookup,
    private readonly slaRules: SlaRuleRepository,
  ) {}

  /** Who may act on (machine, status): the ownership table wins when set. */
  private rolesFor(processKey: string, status: string): Role[] {
    const override = this.ownership.rolesFor(processKey, status);
    if (override) return override as Role[];
    return OWNERS[processKey]?.[status] ?? [];
  }

  private canAct(role: Role, processKey: string, status: string): boolean {
    return role === 'ADMIN' || this.rolesFor(processKey, status).includes(role);
  }

  /** Statuses of one machine this role may act on. */
  private ownedStatuses(role: Role, processKey: string): string[] {
    return Object.keys(OWNERS[processKey] ?? {}).filter((s) => this.canAct(role, processKey, s));
  }

  capabilities(role: Role): Capabilities {
    const ownership: Record<string, string[]> = {};
    for (const processKey of Object.keys(OWNERS)) {
      const owned = this.ownedStatuses(role, processKey);
      if (owned.length > 0) ownership[processKey] = owned;
    }
    return {
      role,
      tabs: TABS[role],
      modules: MODULES[role],
      ownership,
    };
  }

  /**
   * Earliest SLA deadline per (machine, status), in days. Working days are
   * approximated as calendar days for ranking only — the engine itself still
   * does the exact Fri/Sat + holidays maths when it decides to fire.
   */
  private async thresholds(): Promise<Map<string, number>> {
    const rules = await this.slaRules.listAllActive();
    const map = new Map<string, number>();
    for (const rule of rules) {
      if (rule.processKey === 'DOCUMENT_EXPIRY') continue; // deadline-style, not age-style
      const days = rule.afterUnit === 'HOURS' ? rule.afterValue / 24 : rule.afterValue;
      const key = `${rule.processKey}:${rule.status}`;
      const current = map.get(key);
      if (current === undefined || days < current) map.set(key, days);
    }
    return map;
  }

  private static bucketOf(ageDays: number, threshold: number | undefined): {
    bucket: Bucket;
    dueInDays: number | null;
  } {
    // No rule watches this status: it is work, but nothing is counting down.
    if (threshold === undefined) return { bucket: 'later', dueInDays: null };
    const remaining = threshold - ageDays;
    if (remaining <= 0) return { bucket: 'overdue', dueInDays: 0 };
    if (remaining <= 1) return { bucket: 'today', dueInDays: Math.ceil(remaining) };
    if (remaining <= 7) return { bucket: 'week', dueInDays: Math.ceil(remaining) };
    return { bucket: 'later', dueInDays: Math.ceil(remaining) };
  }

  /**
   * One page of the queue. Each machine contributes at most `perKind` rows,
   * so a backlog in one place can never starve the others.
   */
  async queue(
    role: Role,
    opts: { bucket?: Bucket; limit?: number } = {},
  ): Promise<{ items: WorkItem[]; counts: Record<Bucket, number> & { total: number } }> {
    const now = Date.now();
    const perKind = 100;
    const thresholds = await this.thresholds();
    const items: WorkItem[] = [];

    const push = (
      kind: WorkKind,
      row: {
        id: string;
        status: string;
        anchor: Date;
        detail?: string | null;
        employeeId: string;
        employee: { firstName: string; lastName: string; employeeNo: string | null } | null;
      },
    ) => {
      const ageDays = (now - row.anchor.getTime()) / DAY_MS;
      const { bucket, dueInDays } = WorkService.bucketOf(
        ageDays,
        thresholds.get(`${kind}:${row.status}`),
      );
      items.push({
        kind,
        id: row.id,
        employeeId: row.employeeId,
        employeeName: row.employee
          ? `${row.employee.firstName} ${row.employee.lastName}`.trim()
          : '—',
        employeeNo: row.employee?.employeeNo ?? null,
        status: row.status,
        detail: row.detail ?? null,
        since: row.anchor,
        ageDays: Math.floor(ageDays),
        dueInDays,
        bucket,
      });
    };

    const employeeSelect = {
      select: { firstName: true, lastName: true, employeeNo: true },
    } as const;

    // ── the six sources, each queried only when the role owns a status in it
    const pipeline = this.ownedStatuses(role, 'EMPLOYEE');
    if (pipeline.length > 0) {
      const rows = await this.prisma.employee.findMany({
        where: { status: { in: pipeline as never } },
        orderBy: { statusChangedAt: 'asc' },
        take: perKind,
        select: {
          id: true, status: true, statusChangedAt: true,
          firstName: true, lastName: true, employeeNo: true,
        },
      });
      for (const r of rows) {
        push('EMPLOYEE', {
          id: r.id, status: r.status, anchor: r.statusChangedAt, employeeId: r.id,
          employee: { firstName: r.firstName, lastName: r.lastName, employeeNo: r.employeeNo },
        });
      }
    }

    // The two hold-able process models are queried separately: their Prisma
    // delegates are distinct types, so a shared variable is not callable.
    const gosi = this.ownedStatuses(role, 'GOSI');
    if (gosi.length > 0) {
      const rows = await this.prisma.gosiProcess.findMany({
        where: { status: { in: gosi as never } },
        include: { employee: employeeSelect },
        orderBy: { updatedAt: 'asc' },
        take: perKind,
      });
      for (const r of rows) {
        push('GOSI', {
          id: r.id, status: r.status, anchor: r.updatedAt, detail: r.holdReason,
          employeeId: r.employeeId, employee: r.employee,
        });
      }
    }

    const medical = this.ownedStatuses(role, 'MEDICAL_INSURANCE');
    if (medical.length > 0) {
      const rows = await this.prisma.medicalInsuranceProcess.findMany({
        where: { status: { in: medical as never } },
        include: { employee: employeeSelect },
        orderBy: { updatedAt: 'asc' },
        take: perKind,
      });
      for (const r of rows) {
        push('MEDICAL_INSURANCE', {
          id: r.id, status: r.status, anchor: r.updatedAt, detail: r.holdReason,
          employeeId: r.employeeId, employee: r.employee,
        });
      }
    }

    const criminal = this.ownedStatuses(role, 'CRIMINAL_RECORD');
    if (criminal.length > 0) {
      const rows = await this.prisma.criminalRecordProcess.findMany({
        where: { status: { in: criminal as never } },
        include: { employee: employeeSelect },
        orderBy: { updatedAt: 'asc' },
        take: perKind,
      });
      for (const r of rows) {
        push('CRIMINAL_RECORD', {
          id: r.id, status: r.status, anchor: r.updatedAt,
          employeeId: r.employeeId, employee: r.employee,
        });
      }
    }

    const forms = this.ownedStatuses(role, 'ASSET_FORM');
    if (forms.length > 0) {
      const rows = await this.prisma.assetForm.findMany({
        where: { status: { in: forms as never } },
        include: { employee: employeeSelect },
        orderBy: { updatedAt: 'asc' },
        take: perKind,
      });
      for (const r of rows) {
        push('ASSET_FORM', {
          id: r.id, status: r.status, anchor: r.updatedAt,
          employeeId: r.employeeId, employee: r.employee,
        });
      }
    }

    const offboardings = this.ownedStatuses(role, 'OFFBOARDING');
    if (offboardings.length > 0) {
      const rows = await this.prisma.offboarding.findMany({
        where: { status: { in: offboardings as never } },
        include: { employee: employeeSelect },
        orderBy: { updatedAt: 'asc' },
        take: perKind,
      });
      for (const r of rows) {
        push('OFFBOARDING', {
          id: r.id, status: r.status, anchor: r.updatedAt, detail: r.reason,
          employeeId: r.employeeId, employee: r.employee,
        });
      }
    }

    const counts = { overdue: 0, today: 0, week: 0, later: 0, total: items.length };
    for (const item of items) counts[item.bucket] += 1;

    const order: Record<Bucket, number> = { overdue: 0, today: 1, week: 2, later: 3 };
    const filtered = opts.bucket ? items.filter((i) => i.bucket === opts.bucket) : items;
    filtered.sort((a, b) => order[a.bucket] - order[b.bucket] || b.ageDays - a.ageDays);

    return { items: filtered.slice(0, opts.limit ?? 50), counts };
  }
}
