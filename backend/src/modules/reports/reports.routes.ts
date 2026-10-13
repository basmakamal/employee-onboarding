import { Router, type Response } from 'express';
import { asyncHandler } from '../../common/http.js';
import { actorScope, requirePermission } from '../../auth/authz/authorize.js';
import type { ReportsService } from './reports.service.js';

function excelHeaders(res: Response, filename: string) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
}

/**
 * Reports: on-screen summary + Excel downloads (HR/ADMIN). Exports stream
 * batches straight to the response — no in-memory workbook, no row limit.
 */
export function reportsRouter(service: ReportsService): Router {
  const router = Router();
  router.use(requirePermission('reports.view'));

  router.get(
    '/summary',
    asyncHandler(async (req, res) => {
      res.json(await service.summary(actorScope(req.actor)));
    }),
  );

  router.get(
    '/export/employees',
    asyncHandler(async (req, res) => {
      excelHeaders(res, 'employees');
      await service.streamEmployees(res, actorScope(req.actor));
    }),
  );

  router.get(
    '/export/onboarding',
    asyncHandler(async (req, res) => {
      excelHeaders(res, 'onboarding');
      await service.streamOnboarding(res, actorScope(req.actor));
    }),
  );

  router.get(
    '/export/expiring-documents',
    asyncHandler(async (req, res) => {
      excelHeaders(res, 'expiring-documents');
      await service.streamExpiringDocuments(res, actorScope(req.actor));
    }),
  );

  router.get(
    '/export/audit',
    asyncHandler(async (req, res) => {
      const days = Math.min(365, Math.max(1, Number(req.query['days']) || 30));
      excelHeaders(res, `audit-${days}d`);
      await service.streamAudit(res, days, actorScope(req.actor));
    }),
  );

  return router;
}
