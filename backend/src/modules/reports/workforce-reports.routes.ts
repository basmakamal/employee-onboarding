import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, pagedQuery, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import { writeWorkbook, type Sheet, type WorkforceReportsService } from './workforce-reports.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const periodSchema = z
  .object({ from: day, to: day, orgUnitId: z.string().min(1).optional() })
  .refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 92, { message: 'at most three months at a time', path: ['to'] });
const yearSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100), orgUnitId: z.string().min(1).optional() });
const actorOf = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };
const PAYROLL = ['payroll.prepare', 'payroll.approve', 'compensation.read'] as const;

async function excel(res: Response, filename: string, sheets: Sheet[]) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.setHeader('Cache-Control', 'private, no-store');
  await writeWorkbook(res, sheets);
  res.end();
}

/** /api/hr-reports — attendance, leave and payroll reports of the selected company (on screen and Excel). */
export function workforceReportsRouter(service: WorkforceReportsService): Router {
  const router = Router();
  const runId = (req: { params: Record<string, string | undefined> }) => req.params['runId'] as string;

  router.get('/attendance', requirePermission('attendance.read', 'attendance.manage', 'attendance.approve'), validateQuery(periodSchema), asyncHandler(async (req, res) => {
    res.json(await service.attendanceSummary(contextOf(req).companyId, actorScope(req.actor), pagedQuery<z.infer<typeof periodSchema>>(req)));
  }));
  router.get('/attendance.xlsx', requirePermission('attendance.read', 'attendance.manage', 'attendance.approve'), validateQuery(periodSchema), asyncHandler(async (req, res) => {
    const q = pagedQuery<z.infer<typeof periodSchema>>(req);
    await excel(res, `attendance-${q.from}-${q.to}`, [service.attendanceSheet(await service.attendanceSummary(contextOf(req).companyId, actorScope(req.actor), q))]);
  }));

  router.get('/leave', requirePermission('leave.read', 'leave.manage', 'leave.approve'), validateQuery(yearSchema), asyncHandler(async (req, res) => {
    res.json(await service.leaveReport(contextOf(req).companyId, actorScope(req.actor), pagedQuery<z.infer<typeof yearSchema>>(req)));
  }));
  router.get('/leave.xlsx', requirePermission('leave.read', 'leave.manage', 'leave.approve'), validateQuery(yearSchema), asyncHandler(async (req, res) => {
    const q = pagedQuery<z.infer<typeof yearSchema>>(req);
    await excel(res, `leave-${q.year}`, [service.leaveSheet(await service.leaveReport(contextOf(req).companyId, actorScope(req.actor), q))]);
  }));

  router.get('/payroll/:runId/register.xlsx', requirePermission(...PAYROLL), asyncHandler(async (req, res) => {
    const sheet = await service.registerSheet(contextOf(req).companyId, runId(req));
    await excel(res, `payroll-register-${sheet.title.slice(-7)}`, [sheet]);
  }));
  router.get('/payroll/:runId/variance', requirePermission(...PAYROLL), asyncHandler(async (req, res) => {
    res.json(await service.variance(contextOf(req).companyId, runId(req)));
  }));
  router.get('/payroll/:runId/variance.xlsx', requirePermission(...PAYROLL), asyncHandler(async (req, res) => {
    const data = await service.variance(contextOf(req).companyId, runId(req));
    await excel(res, `payroll-variance-${data.month}`, [service.varianceSheet(data)]);
  }));
  /** Full IBANs: only people who see pay, and audited on every export. */
  router.get('/payroll/:runId/bank.xlsx', requirePermission('compensation.read'), asyncHandler(async (req, res) => {
    const sheet = await service.bankSheet(contextOf(req).companyId, runId(req), actorOf(req));
    await excel(res, `bank-transfers-${sheet.title.slice(-7)}`, [sheet]);
  }));
  return router;
}
