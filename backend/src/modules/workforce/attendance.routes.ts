import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler, pagedQuery, validate, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import { GuardFailedError } from '../../workflow/errors.js';
import type { Actor } from '../../workflow/engine.js';
import type { AttendanceService } from './attendance.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');
const note = z.string().trim().max(1000).optional();
const span = (max: number) => (r: { from: string; to: string }) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= max;

const rangeSchema = z.object({ from: day, to: day }).refine(span(62), { message: 'at most two months at a time', path: ['to'] });
const daysSchema = z
  .object({
    from: day,
    to: day,
    orgUnitId: z.string().min(1).optional(),
    q: z.string().trim().max(100).optional(),
    status: z.enum(['PRESENT', 'ABSENT', 'INCOMPLETE', 'REST', 'HOLIDAY', 'UNSCHEDULED', 'LATE', 'EARLY', 'OVERTIME']).optional(),
    review: z.enum(['NONE', 'PENDING', 'CONFIRMED', 'EXCUSED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(span(62), { message: 'at most two months at a time', path: ['to'] });
const requestsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const reviewSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200), decision: z.enum(['CONFIRMED', 'EXCUSED']), note });
const recomputeSchema = z.object({ from: day, to: day, employeeId: z.string().min(1).optional() }).refine(span(62), { message: 'at most two months at a time', path: ['to'] });
const punchSchema = z.object({ date: day, inTime: time.optional(), outTime: time.optional(), note });
const overtimeSchema = z.object({ date: day, minutes: z.number().int().min(1).max(720), reason: z.string().trim().min(3).max(1000) });
const decisionSchema = z.object({ approve: z.boolean(), approvedMinutes: z.number().int().min(1).max(720).optional(), note });

const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };
const READ = ['attendance.read', 'attendance.manage', 'attendance.approve'] as const;

/** /api/attendance — the company's attendance register, exception review and overtime to approve. */
export function attendanceRouter(service: AttendanceService, db: PrismaClient): Router {
  const router = Router();

  router.get('/days', requirePermission(...READ), validateQuery(daysSchema), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const q = pagedQuery<z.infer<typeof daysSchema>>(req);
    let orgUnitPath: string | undefined;
    if (q.orgUnitId) {
      const unit = await db.orgUnit.findFirst({ where: { id: q.orgUnitId, companyId }, select: { path: true } });
      if (!unit) throw new GuardFailedError('BAD_ORG_UNIT', 'pick a branch or department of this company', 'orgUnitId');
      orgUnitPath = unit.path;
    }
    res.json(await service.listDays(companyId, actorScope(req.actor), { ...q, orgUnitPath }));
  }));

  /** HR's decision on exceptions: CONFIRMED (may be deducted) or EXCUSED. */
  router.post('/days/review', requirePermission('attendance.manage'), validate(reviewSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    const count = await service.review(contextOf(req).companyId, body.ids, body.decision, body.note, actorOf(req), actorScope(req.actor));
    res.json({ count });
  }));

  /** Re-judge a period now (after a schedule change, for example). */
  router.post('/recompute', requirePermission('attendance.manage'), validate(recomputeSchema), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const body = req.body as z.infer<typeof recomputeSchema>;
    const scope = actorScope(req.actor) ?? { companyId };
    const people = await db.employee.findMany({
      where: { AND: [scope, body.employeeId ? { id: body.employeeId } : { OR: [{ status: 'ACTIVE' }, { attendanceEvents: { some: {} } }] }] },
      select: { id: true },
    });
    let count = 0;
    const ids = people.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 200) count += await service.recompute(companyId, ids.slice(i, i + 200), body.from, body.to);
    res.json({ count, people: ids.length });
  }));

  router.get('/overtime', requirePermission(...READ), validateQuery(requestsSchema), asyncHandler(async (req, res) => {
    const q = pagedQuery<z.infer<typeof requestsSchema>>(req);
    res.json(await service.listOvertime(contextOf(req).companyId, actorScope(req.actor), q));
  }));
  router.post('/overtime/:id/decision', requirePermission('attendance.approve'), validate(decisionSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    res.json(await service.decideOvertime(contextOf(req).companyId, req.params['id'] as string, body.approve, body.approvedMinutes, body.note, actorOf(req), actorScope(req.actor)));
  }));
  router.get('/pending-count', requirePermission('attendance.approve'), asyncHandler(async (req, res) => {
    res.json(await service.pendingCount(contextOf(req).companyId, actorScope(req.actor)));
  }));

  return router;
}

/**
 * /api/employees/:id/attendance… — one person's attendance on the employee
 * file (behind the /employees/:id scope guard): staff record the in / out
 * times and enter overtime for approval.
 */
export function employeeAttendanceRouter(service: AttendanceService): Router {
  const router = Router();
  router.get('/:id/attendance', requirePermission(...READ), validateQuery(rangeSchema), asyncHandler(async (req, res) => {
    const q = pagedQuery<z.infer<typeof rangeSchema>>(req);
    res.json(await service.personPeriod(contextOf(req).companyId, req.params['id'] as string, q.from, q.to));
  }));
  router.post('/:id/attendance/punches', requirePermission('attendance.manage'), validate(punchSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.recordPunches(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof punchSchema>, actorOf(req)));
  }));
  router.delete('/:id/attendance/punches/:eid', requirePermission('attendance.manage'), asyncHandler(async (req, res) => {
    await service.deletePunch(contextOf(req).companyId, req.params['id'] as string, req.params['eid'] as string, actorOf(req));
    res.status(204).end();
  }));
  router.post('/:id/attendance/overtime', requirePermission('attendance.manage', 'attendance.approve'), validate(overtimeSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.requestOvertime(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof overtimeSchema>, actorOf(req)));
  }));
  router.delete('/:id/attendance/overtime/:rid', requirePermission('attendance.manage', 'attendance.approve'), asyncHandler(async (req, res) => {
    await service.cancelOvertime(contextOf(req).companyId, req.params['id'] as string, req.params['rid'] as string, actorOf(req));
    res.status(204).end();
  }));
  return router;
}
