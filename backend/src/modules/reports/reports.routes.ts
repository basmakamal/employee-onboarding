import { Router, type Response } from 'express';
import type ExcelJS from 'exceljs';
import { asyncHandler } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import type { ReportsService } from './reports.service.js';

async function sendWorkbook(res: Response, wb: ExcelJS.Workbook, filename: string) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/** Reports: on-screen summary + Excel downloads (HR/ADMIN). */
export function reportsRouter(service: ReportsService): Router {
  const router = Router();
  router.use(requireRole('HR', 'ADMIN'));

  router.get(
    '/summary',
    asyncHandler(async (_req, res) => {
      res.json(await service.summary());
    }),
  );

  router.get(
    '/export/employees',
    asyncHandler(async (_req, res) => {
      await sendWorkbook(res, await service.employeesWorkbook(), 'employees');
    }),
  );

  router.get(
    '/export/onboarding',
    asyncHandler(async (_req, res) => {
      await sendWorkbook(res, await service.onboardingWorkbook(), 'onboarding');
    }),
  );

  router.get(
    '/export/expiring-documents',
    asyncHandler(async (_req, res) => {
      await sendWorkbook(res, await service.expiringDocumentsWorkbook(), 'expiring-documents');
    }),
  );

  router.get(
    '/export/audit',
    asyncHandler(async (req, res) => {
      const days = Math.min(365, Math.max(1, Number(req.query['days']) || 30));
      await sendWorkbook(res, await service.auditWorkbook(days), `audit-${days}d`);
    }),
  );

  return router;
}
