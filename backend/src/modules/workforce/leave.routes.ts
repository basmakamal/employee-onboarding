import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler, pagedQuery, validate, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import { GuardFailedError } from '../../workflow/errors.js';
import type { Actor } from '../../workflow/engine.js';
import type { LeaveService } from './leave.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/);
const days = z.number().min(0).max(400);

const typeSchema = z.object({
  code,
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  paidPercent: z.number().int().min(0).max(100).default(100),
  balanceMode: z.enum(['ACCRUAL', 'NONE']),
  accrual: z.enum(['MONTHLY', 'YEARLY']).nullable().optional(),
  daysPerYear: days.nullable().optional(),
  seniorDaysPerYear: days.nullable().optional(),
  seniorAfterYears: z.number().int().min(1).max(50).nullable().optional(),
  carryForwardMax: days.nullable().optional(),
  yearlyLimit: z.number().int().min(1).max(366).nullable().optional(),
  payTiers: z.array(z.object({ days: z.number().int().min(1).max(366), percent: z.number().int().min(0).max(100) })).max(6).nullable().optional(),
  maxPerRequest: z.number().int().min(1).max(366).nullable().optional(),
  oncePerService: z.boolean().optional(),
  minServiceMonths: z.number().int().min(1).max(600).nullable().optional(),
  gender: z.enum(['ANY', 'FEMALE', 'MALE']).default('ANY'),
  countMode: z.enum(['WORKING', 'CALENDAR']).default('WORKING'),
  allowHalfDay: z.boolean().optional(),
  active: z.boolean().optional(),
});
const leaveSchema = z.object({
  leaveTypeId: z.string().min(1),
  startDate: day,
  endDate: day,
  halfDay: z.boolean().optional(),
  reason: z.string().trim().max(1000).optional(),
});
const adjustSchema = z.object({
  leaveTypeId: z.string().min(1),
  days: z.number().min(-400).max(400),
  date: day.optional(),
  note: z.string().trim().min(3).max(500),
});
const listSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  leaveTypeId: z.string().min(1).optional(),
  from: day.optional(),
  to: day.optional(),
  orgUnitId: z.string().min(1).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });

const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };
const READ = ['leave.read', 'leave.manage', 'leave.approve'] as const;

/** /api/leave — leave types (policies) and the company's leave requests. */
export function leaveRouter(service: LeaveService, db: PrismaClient): Router {
  const router = Router();

  router.get('/types', requirePermission(...READ), asyncHandler(async (req, res) => {
    res.json(await service.listTypes(contextOf(req).companyId));
  }));
  router.post('/types', requirePermission('leave.manage'), validate(typeSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.createType(contextOf(req).companyId, req.body as z.infer<typeof typeSchema>, actorOf(req)));
  }));
  router.put('/types/:id', requirePermission('leave.manage'), validate(typeSchema), asyncHandler(async (req, res) => {
    res.json(await service.updateType(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof typeSchema>, actorOf(req)));
  }));
  router.delete('/types/:id', requirePermission('leave.manage'), asyncHandler(async (req, res) => {
    await service.deleteType(contextOf(req).companyId, req.params['id'] as string, actorOf(req));
    res.status(204).end();
  }));

  router.get('/requests', requirePermission(...READ), validateQuery(listSchema), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const q = pagedQuery<z.infer<typeof listSchema>>(req);
    let orgUnitPath: string | undefined;
    if (q.orgUnitId) {
      const unit = await db.orgUnit.findFirst({ where: { id: q.orgUnitId, companyId }, select: { path: true } });
      if (!unit) throw new GuardFailedError('BAD_ORG_UNIT', 'pick a branch or department of this company', 'orgUnitId');
      orgUnitPath = unit.path;
    }
    res.json(await service.list(companyId, actorScope(req.actor), { ...q, orgUnitPath }));
  }));
  router.post('/requests/:id/decision', requirePermission('leave.approve'), validate(decisionSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    res.json(await service.decide(contextOf(req).companyId, req.params['id'] as string, body.approve, body.note, actorOf(req), actorScope(req.actor)));
  }));
  router.get('/pending-count', requirePermission('leave.approve'), asyncHandler(async (req, res) => {
    res.json(await service.pendingCount(contextOf(req).companyId, actorScope(req.actor)));
  }));

  return router;
}

/** /api/employees/:id/leave… — the Leave tab of the employee file (behind the /employees/:id scope guard). */
export function employeeLeaveRouter(service: LeaveService): Router {
  const router = Router();
  router.get('/:id/leave', requirePermission(...READ), asyncHandler(async (req, res) => {
    res.json(await service.person(contextOf(req).companyId, req.params['id'] as string));
  }));
  /** What a leave would take, before it is saved (days, pay, balance after) — or the rule it breaks. */
  router.post('/:id/leave/preview', requirePermission('leave.manage'), validate(leaveSchema), asyncHandler(async (req, res) => {
    const e = await service.evaluate(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof leaveSchema>);
    res.json({ days: e.days, pay: e.pay, balanceAfter: e.balanceAfter, takenBefore: e.takenBefore });
  }));
  router.post('/:id/leave/requests', requirePermission('leave.manage'), validate(leaveSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.request(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof leaveSchema>, actorOf(req)));
  }));
  router.post('/:id/leave/requests/:rid/cancel', requirePermission('leave.manage'), asyncHandler(async (req, res) => {
    await service.cancel(contextOf(req).companyId, req.params['id'] as string, req.params['rid'] as string, actorOf(req));
    res.status(204).end();
  }));
  router.post('/:id/leave/adjustments', requirePermission('leave.manage'), validate(adjustSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.adjust(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof adjustSchema>, actorOf(req)));
  }));
  return router;
}
