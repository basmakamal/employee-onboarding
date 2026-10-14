import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import { actorScope } from '../../auth/authz/authorize.js';
import { AuthService } from '../../auth/auth.service.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { EmployeeRepository } from './employee.repository.js';

/** The notification door, as much of it as an invitation needs. */
interface Mailer {
  notifyExternal(
    email: string,
    templateKey: string,
    params: Record<string, string | number | undefined>,
    ref?: { entity: string; entityId: string; companyId?: string | null },
  ): Promise<void>;
}

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  active: true,
  mustChangePassword: true,
  invitedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/**
 * An employee's own sign-in (self-service), created by HR from the employee
 * file. The account carries the EMPLOYEE role: no staff permission at all,
 * and the staff API refuses it outright (see staffOnly). It opens only while
 * the employee is ACTIVE — it can be prepared in advance, but signing in
 * before the first working day (or after the last) is refused.
 */
export class EmployeeAccountService {
  constructor(
    private readonly db: PrismaClient,
    private readonly employees: Pick<EmployeeRepository, 'findById'>,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
    private readonly audit: AuditLogRepository,
  ) {}

  private async employeeInScope(employeeId: string, actor: Actor) {
    const employee = await this.employees.findById(employeeId, actorScope(actor));
    if (!employee) throw new NotFoundError('employee', employeeId);
    return employee;
  }

  /** The account behind an employee file, or null. */
  async get(employeeId: string, actor: Actor) {
    await this.employeeInScope(employeeId, actor);
    return this.db.user.findUnique({ where: { employeeId }, select: ACCOUNT_SELECT });
  }

  private invite(email: string, name: string, tempPassword: string, employeeId: string, companyId: string | null) {
    return this.mailer.notifyExternal(
      email,
      'employee.account_invitation',
      { name, email, tempPassword, linkUrl: `${this.appUrl.replace(/\/+$/, '')}/login` },
      { entity: 'EMPLOYEE', entityId: employeeId, companyId },
    );
  }

  private log(actor: Actor, employeeId: string, companyId: string | null, action: string, metadata: Record<string, string | boolean> = {}) {
    return this.audit.append({
      entity: 'EMPLOYEE',
      entityId: employeeId,
      action,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId,
      companyId,
      metadata,
    });
  }

  /**
   * Create the sign-in. The e-mail defaults to the employee's own; it must
   * not belong to any other account. The password is temporary either way:
   * e-mailed when `sendInvitation`, otherwise returned once for HR to hand over.
   */
  async create(employeeId: string, input: { email?: string | undefined; sendInvitation: boolean }, actor: Actor) {
    const employee = await this.employeeInScope(employeeId, actor);
    if (await this.db.user.findUnique({ where: { employeeId }, select: { id: true } })) {
      throw new GuardFailedError('ACCOUNT_EXISTS', 'this employee already has a login');
    }
    const email = (input.email?.trim() || employee.email).toLowerCase();
    if (await this.db.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new GuardFailedError('EMAIL_TAKEN', 'another account already signs in with this e-mail', 'email');
    }
    const tempPassword = AuthService.generateTempPassword();
    const name = `${employee.firstName} ${employee.lastName}`.trim();
    const account = await this.db.user.create({
      data: {
        name,
        email,
        role: 'EMPLOYEE',
        employeeId,
        activeCompanyId: employee.companyId,
        passwordHash: await AuthService.hashPassword(tempPassword),
        mustChangePassword: true,
        invitedAt: input.sendInvitation ? new Date() : null,
      },
      select: ACCOUNT_SELECT,
    });
    if (input.sendInvitation) await this.invite(email, name, tempPassword, employeeId, employee.companyId);
    await this.log(actor, employeeId, employee.companyId, 'ACCOUNT_CREATED', { email, invited: input.sendInvitation });
    return { account, ...(input.sendInvitation ? {} : { tempPassword }) };
  }

  /** Switch the sign-in off (or back on) without deleting it. */
  async setActive(employeeId: string, active: boolean, actor: Actor) {
    const employee = await this.employeeInScope(employeeId, actor);
    const account = await this.db.user.findUnique({ where: { employeeId }, select: { id: true } });
    if (!account) throw new NotFoundError('login', employeeId);
    const updated = await this.db.user.update({ where: { id: account.id }, data: { active }, select: ACCOUNT_SELECT });
    await this.log(actor, employeeId, employee.companyId, active ? 'ACCOUNT_ENABLED' : 'ACCOUNT_DISABLED');
    return updated;
  }

  /** A new temporary password — e-mailed, or returned once for HR to hand over. */
  async resetPassword(employeeId: string, input: { sendInvitation: boolean }, actor: Actor) {
    const employee = await this.employeeInScope(employeeId, actor);
    const account = await this.db.user.findUnique({ where: { employeeId }, select: { id: true, email: true, name: true } });
    if (!account) throw new NotFoundError('login', employeeId);
    const tempPassword = AuthService.generateTempPassword();
    const updated = await this.db.user.update({
      where: { id: account.id },
      data: {
        passwordHash: await AuthService.hashPassword(tempPassword),
        mustChangePassword: true,
        ...(input.sendInvitation ? { invitedAt: new Date() } : {}),
      },
      select: ACCOUNT_SELECT,
    });
    if (input.sendInvitation) await this.invite(account.email, account.name, tempPassword, employeeId, employee.companyId);
    await this.log(actor, employeeId, employee.companyId, 'ACCOUNT_PASSWORD_RESET', { invited: input.sendInvitation });
    return { account: updated, ...(input.sendInvitation ? {} : { tempPassword }) };
  }
}
