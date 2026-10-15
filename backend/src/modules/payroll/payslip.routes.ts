import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { PayslipService } from './payslip.service.js';

const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };
const sendSchema = z.object({
  scope: z.enum(['ALL', 'UNIT', 'EMPLOYEE']),
  orgUnitId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  resend: z.boolean().optional(),
});
const settingsSchema = z.object({ autoSend: z.boolean(), sendDay: z.number().int().min(1).max(28) });
const READ = ['payroll.prepare', 'payroll.approve', 'compensation.read'] as const;

/** /api/payroll/… — payslips of a run, sending, and the automatic-sending schedule. */
export function payslipRouter(service: PayslipService): Router {
  const router = Router();
  router.get('/runs/:id/payslips', requirePermission(...READ), asyncHandler(async (req, res) => {
    res.json(await service.forRun(contextOf(req).companyId, req.params['id'] as string));
  }));
  router.get('/runs/:id/lines/:lineId/payslip.pdf', requirePermission(...READ), asyncHandler(async (req, res) => {
    const file = await service.download(contextOf(req).companyId, req.params['lineId'] as string, actorOf(req), { runId: req.params['id'] as string });
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(file.path, file.filename);
  }));
  router.post('/runs/:id/payslips/send', requirePermission('payroll.prepare', 'payroll.approve'), validate(sendSchema), asyncHandler(async (req, res) => {
    res.status(202).json(await service.send(contextOf(req).companyId, req.params['id'] as string, req.body as z.infer<typeof sendSchema>, actorOf(req)));
  }));
  router.get('/payslip-settings', requirePermission('payroll.manage', 'payroll.prepare'), asyncHandler(async (req, res) => {
    res.json(await service.settings(contextOf(req).companyId));
  }));
  router.put('/payslip-settings', requirePermission('payroll.manage'), validate(settingsSchema), asyncHandler(async (req, res) => {
    res.json(await service.saveSettings(contextOf(req).companyId, req.body as z.infer<typeof settingsSchema>, actorOf(req)));
  }));
  return router;
}

/** /api/employees/:id/payslips — the employee's payslips on the Pay tab. */
export function employeePayslipRouter(service: PayslipService): Router {
  const router = Router();
  router.get('/:id/payslips', requirePermission('compensation.read'), asyncHandler(async (req, res) => {
    res.json(await service.forEmployee(contextOf(req).companyId, req.params['id'] as string));
  }));
  router.get('/:id/payslips/:lineId/payslip.pdf', requirePermission('compensation.read'), asyncHandler(async (req, res) => {
    const file = await service.download(contextOf(req).companyId, req.params['lineId'] as string, actorOf(req), { employeeId: req.params['id'] as string });
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(file.path, file.filename);
  }));
  return router;
}
