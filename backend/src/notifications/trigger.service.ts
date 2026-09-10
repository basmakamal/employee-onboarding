import type { EmailTrigger, PrismaClient } from '../generated/prisma/client.js';
import type { TransitionEvent } from '../workflow/engine.js';
import { GuardFailedError, NotFoundError } from '../workflow/errors.js';
import { logger } from '../common/logger.js';
import type { NotificationService } from './notification.service.js';
import { MACHINE_STATUSES, STAFF_ROLES, TEMPLATE_CATALOG } from './template-catalog.js';
import { localeOf } from './locale.js';
import { contractParams } from './contract-params.js';

const CACHE_MS = 30_000;

/** One row of the template picker. */
export interface TemplateOption {
  key: string;
  nameAr: string;
  nameEn: string;
  audience: 'employee' | 'staff';
}

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
    /** Knows every sendable key: built-ins plus admin-created templates. Absent = catalogue only. */
    private readonly templates?: {
      exists(key: string): Promise<boolean>;
      list(): Promise<TemplateOption[]>;
      usesFormLink?(key: string): Promise<boolean>;
      usesContractLink?(key: string): Promise<boolean>;
    },
    /** Issues a signed link when a template asks for {{formLink}} / {{contractLink}}. */
    private readonly links?: {
      issue(
        purpose: 'DATA_FORM' | 'CONTRACT_APPROVAL',
        anchors: { employeeId: string },
      ): Promise<{ url: string }>;
    },
  ) {}

  list() {
    return this.prisma.emailTrigger.findMany({
      orderBy: [{ processKey: 'asc' }, { status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** What the UI's selects can offer. */
  async options() {
    const templates = this.templates
      ? (await this.templates.list()).map((m) => ({
          key: m.key,
          nameAr: m.nameAr,
          nameEn: m.nameEn,
          audience: m.audience,
        }))
      : Object.entries(TEMPLATE_CATALOG).map(([key, m]) => ({
          key,
          nameAr: m.nameAr,
          nameEn: m.nameEn,
          audience: m.audience,
        }));
    return { processes: MACHINE_STATUSES, roles: STAFF_ROLES, templates };
  }

  private async validate(input: TriggerInput): Promise<void> {
    const statuses = MACHINE_STATUSES[input.processKey];
    if (!statuses) throw new GuardFailedError('BAD_PROCESS', `unknown process ${input.processKey}`);
    if (!statuses.includes(input.status)) {
      throw new GuardFailedError('BAD_STATUS', `${input.status} is not a status of ${input.processKey}`);
    }
    const known = this.templates
      ? await this.templates.exists(input.templateKey)
      : !!TEMPLATE_CATALOG[input.templateKey];
    if (!known) {
      throw new GuardFailedError('BAD_TEMPLATE', `unknown template ${input.templateKey}`);
    }
    if (input.recipient === 'ROLE' && !(STAFF_ROLES as readonly string[]).includes(input.role ?? '')) {
      throw new GuardFailedError('BAD_ROLE', 'a staff role is required for ROLE recipients');
    }
  }

  async create(input: TriggerInput, userId?: string): Promise<EmailTrigger> {
    await this.validate(input);
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
    await this.validate(merged);
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
            // The contract terms travel as placeholders, so a status email can quote them.
            contract: { select: { externalRef: true, details: true } },
          },
        })
      : null;

    // {{formLink}} / {{contractLink}}: one fresh link per event, shared by every
    // recipient of it — it is the employee's link either way, and copies must
    // match what they got.
    const formLink = await this.linkFor(matching, employeeId, 'DATA_FORM');
    const contractLink = await this.linkFor(matching, employeeId, 'CONTRACT_APPROVAL');
    const params = {
      name: employee ? `${employee.firstName} ${employee.lastName}`.trim() : '—',
      ...(employee?.employeeNo ? { employeeNo: employee.employeeNo } : {}),
      ...(employee?.department ? { department: employee.department } : {}),
      ...(employee?.jobTitle ? { jobTitle: employee.jobTitle } : {}),
      status: event.to,
      ...contractParams(employee?.contract),
      ...(formLink ? { formLink, linkUrl: formLink } : {}),
      ...(contractLink ? { contractLink, ...(formLink ? {} : { linkUrl: contractLink }) } : {}),
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
  /** A signed URL, issued only when a matching trigger's template asks for it. */
  private async linkFor(
    triggers: EmailTrigger[],
    employeeId: string | undefined,
    purpose: 'DATA_FORM' | 'CONTRACT_APPROVAL',
  ): Promise<string | undefined> {
    const asks =
      purpose === 'DATA_FORM' ? this.templates?.usesFormLink : this.templates?.usesContractLink;
    if (!employeeId || !this.links || !asks) return undefined;
    for (const trigger of triggers) {
      if (!(await asks.call(this.templates, trigger.templateKey))) continue;
      try {
        return (await this.links.issue(purpose, { employeeId })).url;
      } catch (err) {
        logger.error({ err, employeeId, purpose, triggerId: trigger.id }, 'could not issue a link for a trigger');
        return undefined;
      }
    }
    return undefined;
  }

}
