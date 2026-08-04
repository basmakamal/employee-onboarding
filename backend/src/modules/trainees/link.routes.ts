import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { documentUpload } from '../../common/storage.js';
import type { TraineeService } from './trainee.service.js';
import type { AssetService } from '../assets/asset.service.js';
import type { OffboardingService } from '../offboarding/offboarding.service.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';

const formFieldsSchema = z.object({
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  birthDate: z.coerce.date().optional(),
});

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  rejectReason: z.string().optional(),
});

/**
 * PUBLIC endpoints — no staff auth. Possession of a valid signed token IS
 * the authentication (verified on every call).
 */
export function linkRouter(
  service: TraineeService,
  assets: AssetService,
  offboarding: OffboardingService,
  links: LinkTokenService,
): Router {
  const router = Router();

  /** What should this link's page show? Dispatch by the token's purpose. */
  router.get(
    '/:token',
    asyncHandler(async (req, res) => {
      const raw = req.params['token'] as string;
      const row = await links.verify(raw);
      if (row.purpose === 'ASSET_APPROVAL') {
        res.json(await assets.buildLinkContext(row));
        return;
      }
      if (row.purpose === 'EXIT_INTERVIEW') {
        res.json(await offboarding.buildLinkContext(row));
        return;
      }
      res.json(await service.linkContext(raw));
    }),
  );

  /** Exit interview submission (answers stored as structured JSON). */
  router.post(
    '/:token/exit-interview',
    asyncHandler(async (req, res) => {
      const answers = z.record(z.string(), z.string()).parse(req.body ?? {});
      res.json(await offboarding.submitExitInterview(req.params['token'] as string, answers));
    }),
  );

  /** Asset custody decision (approve / reject with reason). */
  router.post(
    '/:token/assets/decision',
    validate(decisionSchema),
    asyncHandler(async (req, res) => {
      const { decision, rejectReason } = req.body as z.infer<typeof decisionSchema>;
      res.json(await assets.decide(req.params['token'] as string, decision, rejectReason));
    }),
  );

  /**
   * Data-form submission: multipart. Each file's field name is the
   * checklist row id it fulfills; text fields carry personal data.
   */
  router.post(
    '/:token/form',
    documentUpload.any(),
    asyncHandler(async (req, res) => {
      const fields = compact(formFieldsSchema.parse(req.body ?? {}));
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const uploads = files.map((f) => ({
        documentId: f.fieldname,
        storageKey: f.filename,
        mimeType: f.mimetype,
        sizeBytes: f.size,
      }));
      res.json(await service.submitForm(req.params['token'] as string, fields, uploads));
    }),
  );

  /** Contract e-approval: one click, one transition, one employee. */
  router.post(
    '/:token/approve-contract',
    asyncHandler(async (req, res) => {
      res.json(await service.approveContract(req.params['token'] as string));
    }),
  );

  return router;
}
