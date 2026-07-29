import type { Db } from '../common/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export type ActorType = 'USER' | 'EMPLOYEE_LINK' | 'SYSTEM';

export interface AuditEntry {
  employeeId: string;
  action: string; // STATUS_TRANSITION | EQUIPMENT_RECEIVED | LINK_SENT | ...
  fromStatus?: string;
  toStatus?: string;
  actorType: ActorType;
  actorId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only by design: this repository exposes no update or delete.
 * Every status transition and every equipment confirmation goes through
 * `append`, inside the same transaction as the change it records.
 */
export class AuditLogRepository {
  constructor(private readonly db: Db) {}

  append(entry: AuditEntry) {
    return this.db.auditLog.create({ data: entry });
  }

  listByEmployee(employeeId: string) {
    return this.db.auditLog.findMany({
      where: { employeeId },
      orderBy: { at: 'asc' },
    });
  }
}
