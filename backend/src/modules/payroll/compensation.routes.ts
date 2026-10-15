import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { CompensationService } from './compensation.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/);
const pct = z.number().min(0).max(100);

const componentSchema = z.object({
  code,
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  kind: z.enum(['EARNING', 'DEDUCTION']).default('EARNING'),
  method: z.enum(['FIXED', 'PERCENT_OF_BASIC']).default('FIXED'),
  defaultPercent: pct.nullable().optional(),
  gosiBase: z.boolean().optional(),
  prorated: z.boolean().optional(),
  hourlyBase: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});
const policySchema = z.object({
  effectiveFrom: day,
  cutoffDay: z.number().int().min(1).max(28),
  payDay: z.number().int().min(1).max(28),
  proration: z.enum(['WORKING_DAYS', 'CALENDAR_DAYS', 'THIRTY_DAYS']).default('WORKING_DAYS'),
  rateDaysPerMonth: z.number().int().min(20).max(31).default(30),
  hoursPerDay: z.number().min(1).max(12).default(8),
  overtimePremiumPct: z.number().min(0).max(200).default(50),
  gosiSaudiEmployeePct: pct.nullable().optional(),
  gosiSaudiEmployerPct: pct.nullable().optional(),
  gosiNonSaudiEmployerPct: pct.nullable().optional(),
  gosiWageCap: z.number().min(0).max(10_000_000).nullable().optional(),
  roundingDecimals: z.number().int().min(0).max(2).default(2),
  note: z.string().trim().max(1000).optional(),
});
const compensationSchema = z.object({
  effectiveFrom: day,
  lines: z.array(z.object({ componentId: z.string().min(1), amount: z.number().min(0).max(10_000_000).nullable().optional(), percent: pct.nullable().optional() })).min(1).max(40),
  reason: z.string().trim().max(1000).optional(),
});

const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

/** /api/payroll — pay components and the payroll policy of the selected company. */
export function payrollSetupRouter(service: CompensationService): Router {
  const router = Router();
  router.get('/components', requirePermission('compensation.read', 'payroll.manage'), asyncHandler(async (req, res) => {
    res.json(await service.listComponents(contextOf(req).companyId));
  }));
  router.post('/components', requirePermission('payroll.manage'), validate(componentSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.createComponent(contextOf(req).companyId, req.body as z.infer<typeof componentSchema>, actorOf(req)));
  }));
  router.put('/components/:id', requirePermission('payroll.manage'), validate(componentSchema), asyncHandler(async (req, res) => {
    res.json(await service.updateComponent(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof componentSchema>, actorOf(req)));
  }));
  router.delete('/components/:id', requirePermission('payroll.manage'), asyncHandler(async (req, res) => {
    await service.deleteComponent(contextOf(req).companyId, req.params['id'] as string, actorOf(req));
    res.status(204).end();
  }));

  router.get('/policy', requirePermission('compensation.read', 'payroll.manage'), asyncHandler(async (req, res) => {
    res.json(await service.listPolicies(contextOf(req).companyId));
  }));
  router.post('/policy', requirePermission('payroll.manage'), validate(policySchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.savePolicy(contextOf(req).companyId, req.body as z.infer<typeof policySchema>, actorOf(req)));
  }));
  return router;
}

/** /api/employees/:id/compensation — the Pay tab of the employee file (behind the /employees/:id scope guard). */
export function employeeCompensationRouter(service: CompensationService): Router {
  const router = Router();
  router.get('/:id/compensation', requirePermission('compensation.read'), asyncHandler(async (req, res) => {
    res.json(await service.forEmployee(contextOf(req).companyId, req.params['id'] as string));
  }));
  router.post('/:id/compensation', requirePermission('compensation.write'), validate(compensationSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.create(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof compensationSchema>, actorOf(req)));
  }));
  router.put('/:id/compensation/:cid', requirePermission('compensation.write'), validate(compensationSchema), asyncHandler(async (req, res) => {
    res.json(await service.update(contextOf(req).companyId, req.params['id'] as string, req.params['cid'] as string, req.body as z.infer<typeof compensationSchema>, actorOf(req)));
  }));
  router.delete('/:id/compensation/:cid', requirePermission('compensation.write'), asyncHandler(async (req, res) => {
    await service.remove(contextOf(req).companyId, req.params['id'] as string, req.params['cid'] as string, actorOf(req));
    res.status(204).end();
  }));
  return router;
}
