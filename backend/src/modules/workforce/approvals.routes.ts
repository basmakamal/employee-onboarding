import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler, pagedQuery, validateQuery } from '../../common/http.js';
import { actorScope, can, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';

const querySchema = z.object({
  /** WAITING: everything the actor may decide · DECIDED: what the actor decided lately. */
  view: z.enum(['WAITING', 'DECIDED']).default('WAITING'),
  kind: z.enum(['LEAVE', 'OVERTIME']).optional(),
});

const EMPLOYEE = { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } } as const;
/** A waiting queue is short in practice; past this many per kind, the oldest show first and the rest wait their turn. */
const CAP = 200;

/**
 * /api/approvals — one inbox for the branch manager, the company manager and
 * the super admin: every leave and overtime request waiting for them (within
 * their scope), oldest first, and what they decided lately. Deciding uses the
 * leave / overtime endpoints, which record the approver.
 */
export function approvalsRouter(db: PrismaClient): Router {
  const router = Router();
  const kindsFor = (actor: Actor | undefined) => ({
    leave: can(actor, 'leave.approve'),
    overtime: can(actor, 'attendance.approve'),
  });

  router.get('/count', requirePermission('leave.approve', 'attendance.approve'), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const scope = actorScope(req.actor);
    const kinds = kindsFor(req.actor);
    const where = { companyId, status: 'PENDING', ...(scope ? { employee: scope } : {}) };
    const [leave, overtime] = await Promise.all([
      kinds.leave ? db.leaveRequest.count({ where }) : 0,
      kinds.overtime ? db.overtimeRequest.count({ where }) : 0,
    ]);
    res.json({ leave, overtime, total: leave + overtime });
  }));

  router.get('/', requirePermission('leave.approve', 'attendance.approve'), validateQuery(querySchema), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const q = pagedQuery<z.infer<typeof querySchema>>(req);
    const scope = actorScope(req.actor);
    const kinds = kindsFor(req.actor);
    const base = { companyId, ...(scope ? { employee: scope } : {}) };
    const filter =
      q.view === 'WAITING'
        ? { ...base, status: 'PENDING' }
        : { ...base, decidedById: req.actor?.id ?? '-', status: { in: ['APPROVED', 'REJECTED'] } };
    const order: Prisma.SortOrder = q.view === 'WAITING' ? 'asc' : 'desc';
    const take = q.view === 'WAITING' ? CAP : 50;

    const [leave, overtime] = await Promise.all([
      kinds.leave && q.kind !== 'OVERTIME'
        ? db.leaveRequest.findMany({
            where: filter,
            include: { employee: EMPLOYEE, leaveType: { select: { code: true, nameAr: true, nameEn: true, color: true, balanceMode: true } } },
            orderBy: q.view === 'WAITING' ? { createdAt: order } : { decidedAt: order },
            take,
          })
        : [],
      kinds.overtime && q.kind !== 'LEAVE'
        ? db.overtimeRequest.findMany({ where: filter, include: { employee: EMPLOYEE }, orderBy: q.view === 'WAITING' ? { createdAt: order } : { decidedAt: order }, take })
        : [],
    ]);

    // The balance a leave approver needs next to a waiting request.
    const balances = new Map<string, number>();
    if (q.view === 'WAITING') {
      const accruing = leave.filter((l) => l.leaveType.balanceMode === 'ACCRUAL');
      if (accruing.length) {
        const sums = await db.leaveLedgerEntry.groupBy({
          by: ['employeeId', 'leaveTypeId'],
          where: { OR: accruing.map((l) => ({ employeeId: l.employeeId, leaveTypeId: l.leaveTypeId })) },
          _sum: { days: true },
        });
        for (const l of accruing) {
          const s = sums.find((x) => x.employeeId === l.employeeId && x.leaveTypeId === l.leaveTypeId);
          balances.set(l.id, Math.round(Number(s?._sum.days ?? 0) * 100) / 100);
        }
      }
    }
    // What the day recorded, next to an overtime request.
    const days = overtime.length
      ? await db.attendanceDay.findMany({
          where: { OR: overtime.map((o) => ({ employeeId: o.employeeId, date: o.date })) },
          select: { employeeId: true, date: true, status: true, firstIn: true, lastOut: true, workedMinutes: true, overtimeMinutes: true },
        })
      : [];
    const ids = [...leave, ...overtime].flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x);
    const users = ids.length ? await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } }) : [];
    const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
    const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });

    const items = [
      ...leave.map((l) => ({
        kind: 'LEAVE' as const,
        id: l.id,
        employee: l.employee,
        createdAt: l.createdAt,
        status: l.status,
        requestedBy: name(l.requestedById),
        decidedBy: name(l.decidedById),
        decidedAt: l.decidedAt,
        decisionNote: l.decisionNote,
        reason: l.reason,
        leave: {
          type: l.leaveType,
          startDate: l.startDate,
          endDate: l.endDate,
          halfDay: l.halfDay,
          days: Number(l.days),
          pay: l.payBreakdown,
          balance: balances.get(l.id) ?? null,
        },
      })),
      ...overtime.map((o) => ({
        kind: 'OVERTIME' as const,
        id: o.id,
        employee: o.employee,
        createdAt: o.createdAt,
        status: o.status,
        requestedBy: name(o.requestedById),
        decidedBy: name(o.decidedById),
        decidedAt: o.decidedAt,
        decisionNote: o.decisionNote,
        reason: o.reason,
        overtime: {
          date: o.date,
          minutes: o.minutes,
          approvedMinutes: o.approvedMinutes,
          day: days.find((d) => d.employeeId === o.employeeId && d.date.getTime() === o.date.getTime()) ?? null,
        },
      })),
    ].sort((a, b) =>
      q.view === 'WAITING'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0),
    );
    res.json({ items, kinds, timezone: company?.timezone ?? 'Asia/Riyadh' });
  }));

  return router;
}
