import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { CompanyService } from './company.service.js';

const createSchema = z.object({
  /** Upper-case letters, digits, underscores — e.g. RIYADA. Fixed after creation. */
  code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,30}$/),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  managerId: z.string().min(1).nullable().optional(),
  /** IANA time zone, e.g. Asia/Riyadh. */
  timezone: z
    .string()
    .trim()
    .refine((tz) => isTimeZone(tz), { message: 'not a known time zone' })
    .optional(),
});

/** True for a time zone the runtime knows (Asia/Riyadh, Europe/London, UTC…). */
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const updateSchema = createSchema.omit({ code: true }).partial();

/**
 * /api/companies — global company administration. Works without a
 * selected company on purpose (it is how a super admin gets one), and
 * exposes counts only — never a company's HR records.
 */
export function companyRouter(service: CompanyService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };
  router.use(requirePermission('companies.manage'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await service.list());
    }),
  );

  router.post(
    '/',
    validate(createSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.create(req.body as z.infer<typeof createSchema>, actor(req)));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await service.get(req.params['id'] as string));
    }),
  );

  router.get(
    '/:id/units',
    asyncHandler(async (req, res) => {
      res.json(await service.listUnits(req.params['id'] as string));
    }),
  );

  router.put(
    '/:id',
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      res.json(await service.update(req.params['id'] as string, req.body as z.infer<typeof updateSchema>, actor(req)));
    }),
  );

  return router;
}
