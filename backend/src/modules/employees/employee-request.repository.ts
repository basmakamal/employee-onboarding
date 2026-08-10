import type { Db } from '../../common/prisma.js';
import type { EmployeeRequestType } from '../../generated/prisma/enums.js';

/** HR services log (salary letter, promotion, warning…) — see schema. */
export class EmployeeRequestRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    type: EmployeeRequestType;
    notes?: string;
    createdById: string;
  }) {
    return this.db.employeeRequest.create({
      data,
      include: { createdBy: { select: { name: true } } },
    });
  }
}
