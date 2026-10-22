import type { Db } from '../common/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export type ActorType = 'USER' | 'LINK' | 'SYSTEM';

export interface AuditEntry {
  entity: string; // EMPLOYEE | GOSI | MEDICAL_INSURANCE | CRIMINAL_RECORD | ASSET_FORM | OFFBOARDING | EMPLOYEE_REQUEST
  entityId: string;
  action: string; // transition action | SLA_REMINDER | SLA_ESCALATION | LINK_SENT | ...
  fromStatus?: string;
  toStatus?: string;
  actorType: ActorType;
  actorId?: string;
  employeeId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only by design: this repository exposes no update or delete.
 * Every transition, SLA action, and e-approval goes through `append`,
 * inside the same transaction as the change it records.
 */
export class AuditLogRepository {
  constructor(private readonly db: Db) {}

  append(entry: AuditEntry) {
    return this.db.auditLog.create({ data: entry });
  }

  listByEntity(entity: string, entityId: string) {
    return this.db.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { at: 'asc' },
    });
  }

  /** Full timeline of an employee's file (all entities anchored to them). */
  listByEmployee(employeeId: string) {
    return this.db.auditLog.findMany({
      where: { employeeId },
      orderBy: { at: 'asc' },
    });
  }
}
