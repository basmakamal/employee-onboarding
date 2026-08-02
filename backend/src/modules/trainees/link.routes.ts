import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact } from '../../common/http.js';
import { documentUpload } from '../../common/storage.js';
import type { TraineeService } from './trainee.service.js';

const formFieldsSchema = z.object({
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  birthDate: z.coerce.date().optional(),
});

/**
 * PUBLIC endpoints — no staff auth. Possession of a valid signed token IS
 * the authentication (verified inside the service on every call).
 */
export function linkRouter(service: TraineeService): Router {
  const router = Router();

  /** What should this link's page show? (form checklist / contract). */
  router.get(
    '/:token',
    asyncHandler(async (req, res) => {
      res.json(await service.linkContext(req.params['token'] as string));
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
