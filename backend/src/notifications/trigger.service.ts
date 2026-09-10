import type { EmailTrigger, PrismaClient } from '../generated/prisma/client.js';
import type { TransitionEvent } from '../workflow/engine.js';
import { GuardFailedError, NotFoundError } from '../workflow/errors.js';
import { logger } from '../common/logger.js';
import type { NotificationService } from './notification.service.js';
import { MACHINE_STATUSES, STAFF_ROLES, TEMPLATE_CATALOG } from './template-catalog.js';
import { localeOf } from './locale.js';

const CACHE_MS = 30_000;

export interface TriggerInput {
  processKey: string;
  status: string;
  templateKey: string;
  recipient: 'SUBJECT' | 'ROLE';
  role?: string | null;
  /** Extra addresses that get their own copy — e.g. an admin checking the wording. */
  ccEmails?: string[] | null;
  active?: boolean;
}

/** Comma-separated column ↔ list. */
export function splitCc(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function joinCc(list: string[] | null | undefined): string | null {
  const clean = [...new Set((list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  return clean.length ? clean.join(',') : null;
}

/**
 * Admin-defined "when X enters status Y, email Z" rules. `handle` is wired to
 * the state-machine engine and runs after the transition's transaction
 * commits, so a rolled-back move never produces an email.
 */
export class TriggerService {
  private cache: { rows: EmailTrigger[]; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: NotificationService,
  ) {}

  list() {
    return this.prisma.emailTrigger.findMany({
      orderBy: [{ processKey: 'asc' }, { status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** What the UI's selects can offer. */
  options() {
    return {
      processes: MACHINE_STATUSES,
      roles: STAFF_ROLES,
      templates: Object.entries(TEMPLATE_CATALOG).map(([key, m]) => ({
        key,
        nameAr: m.nameAr,
        nameEn: m.nameEn,
        audience: m.audience,
      })),
    };
  }

  private validate(input: TriggerInput): void {
    const statuses = MACHINE_STATUSES[input.processKey];
    if (!statuses) throw new GuardFailedError('BAD_PROCESS', `unknown process ${input.processKey}`);
    if (!statuses.includes(input.status)) {
      throw new GuardFailedError('BAD_STATUS', `${input.status} is not a status of ${input.processKey}`);
    }
    if (!TEMPLATE_CATALOG[input.templateKey]) {
      throw new GuardFailedError('BAD_TEMPLATE', `unknown template ${input.templateKey}`);
    }
    if (input.recipient === 'ROLE' && !(STAFF_ROLES as readonly string[]).includes(input.role ?? '')) {
      throw new GuardFailedError('BAD_ROLE', 'a staff role is required for ROLE recipients');
    }
  }

  async create(input: TriggerInput, userId?: string): Promise<EmailTrigger> {
    this.validate(input);
    const row = await this.prisma.emailTrigger.create({
      data: {
        processKey: input.processKey,
        status: input.status,
        templateKey: input.templateKey,
        recipient: input.recipient,
        role: input.recipient === 'ROLE' ? input.role ?? null : null,
        ccEmails: joinCc(input.ccEmails),
        active: input.active ?? true,
        createdById: userId ?? null,
      },
    });
    this.cache = null;
    return row;
  }

  async update(id: string, changes: Partial<TriggerInput>): Promise<EmailTrigger> {
    const existing = await this.prisma.emailTrigger.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('trigger', id);
    const merged: TriggerInput = {
      processKey: changes.processKey ?? existing.processKey,
      status: changes.status ?? existing.status,
      templateKey: changes.templateKey ?? existing.templateKey,
      recipient: changes.recipient ?? existing.recipient,
      role: changes.role !== undefined ? changes.role : existing.role,
      ccEmails: changes.ccEmails !== undefined ? changes.ccEmails : splitCc(existing.ccEmails),
      active: changes.active ?? existing.active,
    };
    this.validate(merged);
    const row = await this.prisma.emailTrigger.update({
      where: { id },
      data: {
        processKey: merged.processKey,
        status: merged.status,
        templateKey: merged.templateKey,
        recipient: merged.recipient,
        role: merged.recipient === 'ROLE' ? merged.role ?? null : null,
        ccEmails: joinCc(merged.ccEmails),
        active: merged.active ?? true,
      },
    });
    this.cache = null;
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.emailTrigger.deleteMany({ where: { id } });
    this.cache = null;
  }

  private async active(): Promise<EmailTrigger[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rows;
    const rows = await this.prisma.emailTrigger.findMany({ where: { active: true } });
    this.cache = { rows, at: Date.now() };
    return rows;
  }

  /** Engine hook — see `onTransition` in workflow/engine.ts. */
  async handle(event: TransitionEvent): Promise<void> {
    const matching = (await this.active()).filter(
      (t) => t.processKey === event.entity && t.status === event.to,
    );
    if (matching.length === 0) return;

    const employeeId = event.entity === 'EMPLOYEE' ? event.entityId : event.employeeId;
    const employee = employeeId
      ? await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: {
            firstName: true, lastName: true, email: true,
            employeeNo: true, department: true, jobTitle: true, preferredLanguage: true,
          },
        })
      : null;

    const params = {
      name: employee ? `${employee.firstName} ${employee.lastName}`.trim() : '—',
      ...(employee?.employeeNo ? { employeeNo: employee.employeeNo } : {}),
      ...(employee?.department ? { department: employee.department } : {}),
      ...(employee?.jobTitle ? { jobTitle: employee.jobTitle } : {}),
      status: event.to,
    };
    const ref = { entity: event.entity, entityId: event.entityId };

    // Every send is isolated: a failure for the group, the employee or one
    // copy address is logged and the rest still go out.
    const attempt = async (what: string, triggerId: string, send: () => Promise<void>) => {
      try {
        await send();
      } catch (err) {
        logger.error({ err, triggerId, what }, 'email trigger send failed');
      }
    };

    for (const trigger of matching) {
      if (trigger.recipient === 'SUBJECT') {
        if (!employee?.email) {
          logger.warn({ triggerId: trigger.id, event }, 'trigger has no employee email to send to');
        } else {
          await attempt('subject', trigger.id, () =>
            this.notifications.notifyExternal(employee.email, trigger.templateKey, params, ref, localeOf(employee)),
          );
        }
      } else {
        await attempt('role', trigger.id, () =>
          this.notifications.notifyRole(trigger.role ?? 'HR', trigger.templateKey, params, ref),
        );
      }
      // Copies: each address gets its own row in the email history, so the
      // person checking can see exactly what went out and remove themselves later.
      for (const cc of splitCc(trigger.ccEmails)) {
        await attempt(`cc:${cc}`, trigger.id, () =>
          this.notifications.notifyExternal(cc, trigger.templateKey, params, ref),
        );
      }
    }
  }
}
