import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler, pagedQuery, validate, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import { GuardFailedError } from '../../workflow/errors.js';
import type { Actor } from '../../workflow/engine.js';
import type { ScheduleService } from './schedule.service.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/);

const shiftSchema = z.object({
  code,
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  kind: z.enum(['FIXED', 'FLEXIBLE']).default('FIXED'),
  startTime: time,
  endTime: time,
  breakMinutes: z.number().int().min(0).max(480).default(0),
  graceMinutes: z.number().int().min(0).max(240).default(0),
  requiredMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  active: z.boolean().optional(),
});

const patternSchema = z.object({
  code,
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  kind: z.enum(['WEEKLY', 'ROTATION']),
  cycleDays: z.number().int().min(1).max(56).default(7),
  days: z.array(z.array(z.string().min(1)).max(4)).min(1).max(56),
  active: z.boolean().optional(),
});

const assignSchema = z.object({
  patternId: z.string().min(1),
  startDate: day,
  endDate: day.nullable().optional(),
  temporary: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional(),
});

const rangeSchema = z
  .object({ from: day, to: day })
  .refine((r) => r.from <= r.to, { message: 'from must be on or before to', path: ['to'] })
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 62, { message: 'at most two months at a time', path: ['to'] });

const teamSchema = z
  .object({
    from: day,
    to: day,
    orgUnitId: z.string().min(1).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 31, { message: 'at most one month at a time', path: ['to'] });

const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

/** /api/workforce — shift definitions, patterns and the team schedule of the selected company. */
export function workforceRouter(service: ScheduleService, db: PrismaClient): Router {
  const router = Router();

  router.get('/shifts', requirePermission('schedule.read', 'schedule.manage'), asyncHandler(async (req, res) => {
    res.json(await service.listShifts(contextOf(req).companyId));
  }));
  router.post('/shifts', requirePermission('schedule.manage'), validate(shiftSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.createShift(contextOf(req).companyId, req.body as z.infer<typeof shiftSchema>, actorOf(req)));
  }));
  router.put('/shifts/:id', requirePermission('schedule.manage'), validate(shiftSchema), asyncHandler(async (req, res) => {
    res.json(await service.updateShift(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof shiftSchema>, actorOf(req)));
  }));
  router.delete('/shifts/:id', requirePermission('schedule.manage'), asyncHandler(async (req, res) => {
    await service.deleteShift(contextOf(req).companyId, req.params['id'] as string, actorOf(req));
    res.status(204).end();
  }));

  router.get('/patterns', requirePermission('schedule.read', 'schedule.manage'), asyncHandler(async (req, res) => {
    res.json(await service.listPatterns(contextOf(req).companyId));
  }));
  router.post('/patterns', requirePermission('schedule.manage'), validate(patternSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPattern(contextOf(req).companyId, req.body as z.infer<typeof patternSchema>, actorOf(req)));
  }));
  router.put('/patterns/:id', requirePermission('schedule.manage'), validate(patternSchema), asyncHandler(async (req, res) => {
    res.json(await service.updatePattern(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof patternSchema>, actorOf(req)));
  }));
  router.delete('/patterns/:id', requirePermission('schedule.manage'), asyncHandler(async (req, res) => {
    await service.deletePattern(contextOf(req).companyId, req.params['id'] as string, actorOf(req));
    res.status(204).end();
  }));

  /** Who works what, day by day, for the active people the actor may see (a page at a time). */
  router.get('/team-schedule', requirePermission('schedule.read', 'schedule.manage'), validateQuery(teamSchema), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const q = pagedQuery<z.infer<typeof teamSchema>>(req);
    const scope = actorScope(req.actor) ?? { companyId };
    const filters: Prisma.EmployeeWhereInput[] = [scope, { status: 'ACTIVE' }];
    if (q.orgUnitId) {
      const unit = await db.orgUnit.findFirst({ where: { id: q.orgUnitId, companyId }, select: { path: true } });
      if (!unit) throw new GuardFailedError('BAD_ORG_UNIT', 'pick a branch or department of this company', 'orgUnitId');
      filters.push({ orgUnit: { path: { startsWith: unit.path } } });
    }
    if (q.q) filters.push({ OR: [{ firstName: { contains: q.q } }, { lastName: { contains: q.q } }, { employeeNo: { contains: q.q } }] });
    const where: Prisma.EmployeeWhereInput = { AND: filters };
    const [people, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      db.employee.count({ where }),
    ]);
    const days = await service.resolveMany(companyId, people.map((p) => p.id), q.from, q.to);
    res.json({ total, items: people.map((p) => ({ ...p, days: days.get(p.id) ?? [] })) });
  }));

  return router;
}

/**
 * /api/employees/:id/schedule… — one person's schedule (behind the
 * /employees/:id scope guard). Reading follows schedule.read; assigning and
 * ending follow schedule.manage.
 */
export function employeeScheduleRouter(service: ScheduleService): Router {
  const router = Router();
  router.get('/:id/schedule-assignments', requirePermission('schedule.read', 'schedule.manage'), asyncHandler(async (req, res) => {
    res.json(await service.listAssignments(req.params['id'] as string));
  }));
  router.post('/:id/schedule-assignments', requirePermission('schedule.manage'), validate(assignSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.assign(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof assignSchema>, actorOf(req)));
  }));
  router.put('/:id/schedule-assignments/:aid', requirePermission('schedule.manage'), validate(z.object({ endDate: day })), asyncHandler(async (req, res) => {
    const { endDate } = req.body as { endDate: string };
    res.json(await service.endAssignment(contextOf(req).companyId, req.params['id'] as string, req.params['aid'] as string, endDate, actorOf(req)));
  }));
  router.delete('/:id/schedule-assignments/:aid', requirePermission('schedule.manage'), asyncHandler(async (req, res) => {
    await service.removeAssignment(contextOf(req).companyId, req.params['id'] as string, req.params['aid'] as string, actorOf(req));
    res.status(204).end();
  }));
  router.get('/:id/schedule', requirePermission('schedule.read', 'schedule.manage'), validateQuery(rangeSchema), asyncHandler(async (req, res) => {
    const q = pagedQuery<z.infer<typeof rangeSchema>>(req);
    res.json(await service.resolve(contextOf(req).companyId, req.params['id'] as string, q.from, q.to));
  }));
  return router;
}
