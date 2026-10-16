import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { PayrollService } from './payroll.service.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };
const READ = ['payroll.prepare', 'payroll.approve'] as const;

/** /api/payroll/runs — the monthly payroll of the selected company. */
export function payrollRunRouter(service: PayrollService): Router {
  const router = Router();
  const id = (req: { params: Record<string, string | undefined> }) => req.params['id'] as string;

  router.get('/runs', requirePermission(...READ), asyncHandler(async (req, res) => {
    res.json(await service.list(contextOf(req).companyId));
  }));
  /** Calculate a month (a new run, or the open one again). */
  router.post('/runs', requirePermission('payroll.prepare'), validate(z.object({ month })), asyncHandler(async (req, res) => {
    res.status(201).json(await service.calculateMonth(contextOf(req).companyId, (req.body as { month: string }).month, actorOf(req)));
  }));
  router.get('/runs/:id', requirePermission(...READ), asyncHandler(async (req, res) => {
    res.json(await service.get(contextOf(req).companyId, id(req)));
  }));
  router.post('/runs/:id/recalculate', requirePermission('payroll.prepare'), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    await service.recalculate(companyId, id(req), actorOf(req));
    res.json(await service.get(companyId, id(req)));
  }));
  router.post('/runs/:id/lines/:lineId/hold', requirePermission('payroll.prepare'), validate(z.object({ held: z.boolean(), reason: z.string().trim().max(500).optional() })), asyncHandler(async (req, res) => {
    const { companyId } = contextOf(req);
    const body = req.body as { held: boolean; reason?: string };
    await service.hold(companyId, id(req), req.params['lineId'] as string, body.held, body.reason, actorOf(req));
    res.json(await service.get(companyId, id(req)));
  }));
  router.post('/runs/:id/approve', requirePermission('payroll.approve'), validate(z.object({ note: z.string().trim().max(1000).optional() })), asyncHandler(async (req, res) => {
    res.json(await service.approve(contextOf(req).companyId, id(req), (req.body as { note?: string }).note, actorOf(req)));
  }));
  /** Undo an approval before payment — with a reason; never once payslips went out. */
  router.post('/runs/:id/reopen', requirePermission('payroll.approve'), validate(z.object({ reason: z.string().trim().min(3).max(1000) })), asyncHandler(async (req, res) => {
    res.json(await service.reopen(contextOf(req).companyId, id(req), (req.body as { reason: string }).reason, actorOf(req)));
  }));
  router.post('/runs/:id/paid', requirePermission('payroll.approve', 'payroll.prepare'), asyncHandler(async (req, res) => {
    res.json(await service.markPaid(contextOf(req).companyId, id(req), actorOf(req)));
  }));
  router.post('/runs/:id/cancel', requirePermission('payroll.prepare'), asyncHandler(async (req, res) => {
    await service.cancel(contextOf(req).companyId, id(req), actorOf(req));
    res.status(204).end();
  }));
  return router;
}
