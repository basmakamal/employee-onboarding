import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler, pagedQuery, validateQuery } from '../../common/http.js';
import { actorScope, auditScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  entity: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
  source: z.enum(['WEB', 'LINK', 'SCHEDULER', 'SYSTEM']).optional(),
  from: day.optional(),
  to: day.optional(),
  /** Employee name / number, or a record id. */
  q: z.string().trim().max(100).optional(),
});

/**
 * /api/audit — the audit trail of the selected company: who did what, when,
 * from where, with before / after values. Read-only — there is no route that
 * changes or deletes an entry (old rows are only ever archived to a file by
 * the nightly retention job). A branch manager with the permission sees the
 * rows about their own branches' people only.
 */
export function auditRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(requirePermission('audit.read'));

  router.get(
    '/',
    validateQuery(listSchema),
    asyncHandler(async (req, res) => {
      const { companyId } = contextOf(req);
      const q = pagedQuery<z.infer<typeof listSchema>>(req);
      const scope = auditScope(actorScope(req.actor) ?? { companyId });
      const filters: Prisma.AuditLogWhereInput[] = [scope];
      if (q.entity) filters.push({ entity: q.entity });
      if (q.action) filters.push({ action: q.action });
      if (q.source) filters.push({ source: q.source });
      if (q.from || q.to) {
        const to = q.to ? new Date(`${q.to}T00:00:00Z`) : undefined;
        if (to) to.setUTCDate(to.getUTCDate() + 1);
        filters.push({ at: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(to ? { lt: to } : {}) } });
      }
      if (q.q) {
        filters.push({
          OR: [
            { entityId: q.q },
            { requestId: q.q },
            { employee: { OR: [{ firstName: { contains: q.q } }, { lastName: { contains: q.q } }, { employeeNo: { contains: q.q } }] } },
          ],
        });
      }
      const where: Prisma.AuditLogWhereInput = { AND: filters };
      const [items, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          select: {
            id: true, at: true, entity: true, entityId: true, action: true, fromStatus: true, toStatus: true,
            actorType: true, metadata: true, changes: true, source: true, requestId: true,
            actor: { select: { id: true, name: true } },
            employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } },
          },
          orderBy: { at: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        db.auditLog.count({ where }),
      ]);
      res.json({ items, total });
    }),
  );

  /** The record types and actions present in this company — the filter choices. */
  router.get(
    '/facets',
    asyncHandler(async (req, res) => {
      const { companyId } = contextOf(req);
      const scope = auditScope(actorScope(req.actor) ?? { companyId });
      const rows = await db.auditLog.groupBy({ by: ['entity', 'action'], where: scope, _count: { _all: true } });
      res.json({
        entities: [...new Set(rows.map((r) => r.entity))].sort(),
        actions: [...new Set(rows.map((r) => r.action))].sort(),
      });
    }),
  );

  return router;
}
