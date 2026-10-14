import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler, pagedQuery, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';

const page = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Name, employee number or e-mail. */
  q: z.string().trim().max(100).optional(),
};

const contractsQuery = z.object({
  ...page,
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'EXPIRED']).optional(),
});
const documentsQuery = z.object({
  ...page,
  /** expired · due within N days · all */
  window: z.enum(['expired', '30', '60', '90', 'all']).default('90'),
  type: z.string().trim().max(60).optional(),
});
const offboardingsQuery = z.object({
  ...page,
  /** open = everything not closed or cancelled */
  status: z.enum(['open', 'REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT', 'CLOSED', 'CANCELLED']).default('open'),
});

const EMPLOYEE = { select: { id: true, firstName: true, lastName: true, employeeNo: true, status: true } } as const;

/** Name / number / e-mail search on the employee relation, inside the scope. */
function employeeWhere(scope: Prisma.EmployeeWhereInput, q?: string): Prisma.EmployeeWhereInput {
  if (!q) return scope;
  return {
    AND: [
      scope,
      { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { employeeNo: { contains: q } }, { email: { contains: q } }] },
    ],
  };
}

/** Contract end = start + duration (both typed by HR into the contract details). */
function contractEnd(details: unknown): { startDate: string | null; durationMonths: number | null; endDate: string | null } {
  const d = (details ?? {}) as Record<string, unknown>;
  const startDate = typeof d['startDate'] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d['startDate']) ? d['startDate'].slice(0, 10) : null;
  const months = Number(d['durationMonths']);
  const durationMonths = Number.isFinite(months) && months > 0 ? Math.round(months) : null;
  let endDate: string | null = null;
  if (startDate && durationMonths) {
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + durationMonths);
    end.setUTCDate(end.getUTCDate() - 1);
    endDate = end.toISOString().slice(0, 10);
  }
  return { startDate, durationMonths, endDate };
}

/**
 * /api/registers — company-wide lists behind the Employees menu: contracts,
 * expiry-tracked documents and offboardings. Every list is limited to the
 * selected company and the actor's branch scope, paged on the server, and
 * returns only what the list shows (no salary, no document numbers).
 */
export function registersRouter(db: PrismaClient): Router {
  const router = Router();
  const scopeOf = (req: Parameters<typeof contextOf>[0]) => actorScope(req.actor) ?? { companyId: contextOf(req).companyId };

  router.get(
    '/contracts',
    requirePermission('contracts.write', 'employees.read'),
    validateQuery(contractsQuery),
    asyncHandler(async (req, res) => {
      const q = pagedQuery<z.infer<typeof contractsQuery>>(req);
      const where: Prisma.ContractWhereInput = {
        employee: employeeWhere(scopeOf(req), q.q),
        ...(q.status ? { status: q.status } : {}),
      };
      const [rows, total] = await Promise.all([
        db.contract.findMany({
          where,
          select: { id: true, status: true, statusChangedAt: true, externalRef: true, details: true, approvedAt: true, employee: EMPLOYEE },
          orderBy: { statusChangedAt: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        db.contract.count({ where }),
      ]);
      res.json({
        total,
        items: rows.map(({ details, ...r }) => ({ ...r, ...contractEnd(details) })),
      });
    }),
  );

  router.get(
    '/documents',
    requirePermission('documents.read'),
    validateQuery(documentsQuery),
    asyncHandler(async (req, res) => {
      const q = pagedQuery<z.infer<typeof documentsQuery>>(req);
      const today = new Date(new Date().toISOString().slice(0, 10));
      const until = new Date(today);
      if (q.window !== 'expired' && q.window !== 'all') until.setUTCDate(until.getUTCDate() + Number(q.window));
      const where: Prisma.EmployeeDocumentWhereInput = {
        employee: employeeWhere(scopeOf(req), q.q),
        ...(q.type ? { type: q.type } : {}),
        ...(q.window === 'expired' ? { expiryDate: { lt: today } } : q.window === 'all' ? {} : { expiryDate: { lte: until } }),
      };
      const [items, total] = await Promise.all([
        db.employeeDocument.findMany({
          where,
          select: { id: true, type: true, expiryDate: true, employee: EMPLOYEE },
          orderBy: { expiryDate: 'asc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        db.employeeDocument.count({ where }),
      ]);
      res.json({ total, items });
    }),
  );

  router.get(
    '/offboardings',
    requirePermission('offboarding.manage', 'settlement.approve'),
    validateQuery(offboardingsQuery),
    asyncHandler(async (req, res) => {
      const q = pagedQuery<z.infer<typeof offboardingsQuery>>(req);
      const where: Prisma.OffboardingWhereInput = {
        employee: employeeWhere(scopeOf(req), q.q),
        ...(q.status === 'open' ? { status: { notIn: ['CLOSED', 'CANCELLED'] } } : { status: q.status }),
      };
      const [items, total] = await Promise.all([
        db.offboarding.findMany({
          where,
          select: { id: true, status: true, reason: true, createdAt: true, updatedAt: true, closedAt: true, employee: EMPLOYEE },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        db.offboarding.count({ where }),
      ]);
      res.json({ total, items });
    }),
  );

  return router;
}
