import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, pagedQuery, validate, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { LoanService } from './loan.service.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const amount = z.number().positive().max(1_000_000);
const loanSchema = z.object({
  kind: z.enum(['ADVANCE', 'LOAN']),
  amount,
  instalments: z.number().int().min(1).max(60).default(1),
  startMonth: month,
  reason: z.string().trim().min(3).max(1000),
});
const paymentSchema = z.object({
  kind: z.enum(['EARNING', 'DEDUCTION']),
  category: z.string().min(1).max(40),
  amount,
  month,
  reason: z.string().trim().min(3).max(1000),
  correctsRunId: z.string().min(1).optional(),
});
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });
const registerSchema = z.object({
  view: z.enum(['LOANS', 'PAYMENTS']).default('LOANS'),
  status: z.enum(['PENDING', 'APPROVED', 'SETTLED', 'REJECTED', 'CANCELLED', 'PAID']).optional(),
  month: month.optional(),
});

const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

/** /api/payroll/loans, /api/payroll/payments — the company registers and the approver's decisions. */
export function loanRouter(service: LoanService): Router {
  const router = Router();
  router.get('/money', requirePermission('compensation.read', 'pay.approve'), validateQuery(registerSchema), asyncHandler(async (req, res) => {
    const q = pagedQuery<z.infer<typeof registerSchema>>(req);
    res.json(await service.register(contextOf(req).companyId, actorScope(req.actor), q));
  }));
  router.post('/loans/:id/decision', requirePermission('pay.approve'), validate(decisionSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    res.json(await service.decideLoan(contextOf(req).companyId, req.params['id'] as string, body.approve, body.note, actorOf(req), actorScope(req.actor)));
  }));
  router.post('/payments/:id/decision', requirePermission('pay.approve'), validate(decisionSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    res.json(await service.decidePayment(contextOf(req).companyId, req.params['id'] as string, body.approve, body.note, actorOf(req), actorScope(req.actor)));
  }));
  return router;
}

/** /api/employees/:id/loans… and /payments… — on the Pay tab (behind the /employees/:id scope guard). */
export function employeeLoanRouter(service: LoanService): Router {
  const router = Router();
  const id = (req: { params: Record<string, string | undefined> }) => req.params['id'] as string;
  router.get('/:id/loans', requirePermission('compensation.read'), asyncHandler(async (req, res) => {
    res.json(await service.forEmployee(contextOf(req).companyId, id(req)));
  }));
  /** The schedule and the Art. 92 check of a loan, before it is saved. */
  router.post('/:id/loans/preview', requirePermission('compensation.write'), validate(loanSchema), asyncHandler(async (req, res) => {
    res.json(await service.evaluateLoan(contextOf(req).companyId, id(req), req.body as z.infer<typeof loanSchema>));
  }));
  router.post('/:id/loans', requirePermission('compensation.write'), validate(loanSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.requestLoan(contextOf(req).companyId, id(req), req.body as z.infer<typeof loanSchema>, actorOf(req)));
  }));
  router.post('/:id/loans/:lid/cancel', requirePermission('compensation.write'), asyncHandler(async (req, res) => {
    await service.cancelLoan(contextOf(req).companyId, id(req), req.params['lid'] as string, actorOf(req));
    res.status(204).end();
  }));
  router.post('/:id/loans/:lid/instalments/:iid/postpone', requirePermission('compensation.write'), asyncHandler(async (req, res) => {
    await service.postpone(contextOf(req).companyId, id(req), req.params['lid'] as string, req.params['iid'] as string, actorOf(req));
    res.status(204).end();
  }));
  router.post('/:id/loans/:lid/settle', requirePermission('compensation.write'), validate(z.object({ note: z.string().trim().min(3).max(500) })), asyncHandler(async (req, res) => {
    await service.settle(contextOf(req).companyId, id(req), req.params['lid'] as string, (req.body as { note: string }).note, actorOf(req));
    res.status(204).end();
  }));
  router.post('/:id/payments', requirePermission('compensation.write'), validate(paymentSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await service.requestPayment(contextOf(req).companyId, id(req), req.body as z.infer<typeof paymentSchema>, actorOf(req)));
  }));
  router.post('/:id/payments/:pid/cancel', requirePermission('compensation.write'), asyncHandler(async (req, res) => {
    await service.cancelPayment(contextOf(req).companyId, id(req), req.params['pid'] as string, actorOf(req));
    res.status(204).end();
  }));
  return router;
}
