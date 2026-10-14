import { Router, type Request } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { asyncHandler } from '../../common/http.js';
import { storagePath } from '../../common/storage.js';
import { ForbiddenError, NotFoundError } from '../../workflow/errors.js';

const MIME_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** The employee this request may see — only a self-service account has one. */
function selfOf(req: Request): string {
  const id = req.actor?.employeeId;
  if (!id) throw new ForbiddenError('My space is for employee accounts');
  return id;
}

/**
 * /api/me — an employee's own data, for their self-service sign-in. Every
 * query is pinned to the employee id carried by the session (never taken
 * from the URL or body), so one employee can never ask for another.
 * Sensitive fields (national id, IBAN) are masked; HR-internal records
 * (warnings, investigations, notes) are not exposed.
 */
export function meRouter(db: PrismaClient): Router {
  const router = Router();

  router.get(
    '/profile',
    asyncHandler(async (req, res) => {
      const id = selfOf(req);
      const e = await db.employee.findUnique({
        where: { id },
        select: {
          id: true,
          employeeNo: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          nationalId: true,
          iban: true,
          hireDate: true,
          employmentType: true,
          status: true,
          company: { select: { nameAr: true, nameEn: true } },
          orgUnit: { select: { nameAr: true, nameEn: true } },
          position: { select: { titleAr: true, titleEn: true } },
          manager: { select: { firstName: true, lastName: true } },
          contract: { select: { status: true, details: true } },
        },
      });
      if (!e) throw new NotFoundError('employee', id);
      const mask = (v: string | null, keep: number) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);
      const details = (e.contract?.details ?? {}) as Record<string, unknown>;
      res.json({
        ...e,
        nationalId: mask(e.nationalId, 4),
        iban: mask(e.iban, 4),
        manager: e.manager ? `${e.manager.firstName} ${e.manager.lastName}`.trim() : null,
        contract: e.contract
          ? {
              status: e.contract.status,
              startDate: typeof details['startDate'] === 'string' ? details['startDate'] : null,
              durationMonths: details['durationMonths'] ?? null,
            }
          : null,
      });
    }),
  );

  /** Career history: what took effect and what is scheduled (not cancelled drafts). */
  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const id = selfOf(req);
      res.json(
        await db.employmentEvent.findMany({
          where: { employeeId: id, status: { in: ['APPLIED', 'SCHEDULED'] } },
          select: { id: true, batchId: true, category: true, oldValue: true, newValue: true, effectiveDate: true, status: true, recordedAt: true },
          orderBy: [{ effectiveDate: 'desc' }, { recordedAt: 'desc' }],
        }),
      );
    }),
  );

  /** My documents: expiry-tracked ones (Iqama, passport…) and the files sent with the data form. */
  router.get(
    '/documents',
    asyncHandler(async (req, res) => {
      const id = selfOf(req);
      const [expiry, onboarding] = await Promise.all([
        db.employeeDocument.findMany({
          where: { employeeId: id },
          select: { id: true, type: true, expiryDate: true },
          orderBy: { expiryDate: 'asc' },
        }),
        db.onboardingDocument.findMany({
          where: { employeeId: id, storageKey: { not: null } },
          select: { id: true, type: true, label: true, uploadedAt: true, mimeType: true },
        }),
      ]);
      res.json({ expiry, onboarding });
    }),
  );

  router.get(
    '/documents/:docId/file',
    asyncHandler(async (req, res) => {
      const id = selfOf(req);
      const doc = await db.onboardingDocument.findFirst({
        where: { id: req.params['docId'] as string, employeeId: id, storageKey: { not: null } },
      });
      if (!doc?.storageKey) throw new NotFoundError('document', req.params['docId'] as string);
      res.download(storagePath(doc.storageKey), `${doc.type}${MIME_EXT[doc.mimeType ?? ''] ?? ''}`);
    }),
  );

  return router;
}
