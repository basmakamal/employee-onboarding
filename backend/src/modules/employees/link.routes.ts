import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import {
  discardUploads,
  documentUpload,
  employeeSubdir,
  removeStoredFiles,
  storageKeyFor,
  verifyUploadedFiles,
} from '../../common/storage.js';
import { NotFoundError } from '../../workflow/errors.js';
import type { OnboardingService } from './onboarding.service.js';
import type { AssetService } from '../assets/asset.service.js';
import type { OffboardingService } from '../offboarding/offboarding.service.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';
// The full employee data form — every field required, Saudi formats checked
// server-side because a public signed link is the only gate in front of it.
import { dataFormSchema } from './data-form.schema.js';


const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  rejectReason: z.string().optional(),
});

/**
 * PUBLIC endpoints — no staff auth. Possession of a valid signed token IS
 * the authentication (verified on every call).
 */
export function linkRouter(
  service: OnboardingService,
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
   *
   * The token gate runs BEFORE multer parses the body, so no byte is
   * written to disk for an invalid, expired or wrong-purpose link. Files
   * are then sniffed (magic bytes vs declared type), and any failure after
   * that point discards everything this request wrote.
   */
  router.post(
    '/:token/form',
    asyncHandler(async (req, _res, next) => {
      const row = await links.verify(req.params['token'] as string);
      if (row.purpose !== 'DATA_FORM' || !row.employeeId) {
        throw new NotFoundError('link', 'not a data-form link');
      }
      req.uploadSubdir = employeeSubdir(row.employeeId);
      next();
    }),
    documentUpload.any(),
    asyncHandler(async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      try {
        await verifyUploadedFiles(files);
        const fields = compact(dataFormSchema.parse(req.body ?? {}));
        const uploads = files.map((f) => ({
          documentId: f.fieldname,
          storageKey: storageKeyFor(req.uploadSubdir as string, f.filename),
          mimeType: f.mimetype,
          sizeBytes: f.size,
        }));
        const { orphanedKeys, ...result } = await service.submitForm(
          req.params['token'] as string,
          fields,
          uploads,
        );
        // Files this submission made unreferenced: replaced re-uploads and
        // unknown field names. Removed only after the commit.
        await removeStoredFiles(orphanedKeys);
        res.json(result);
      } catch (err) {
        await discardUploads(files);
        throw err;
      }
    }),
  );

  /** Contract e-approval: one click, one transition, one activated employee. */
  router.post(
    '/:token/approve-contract',
    asyncHandler(async (req, res) => {
      res.json(await service.approveContract(req.params['token'] as string));
    }),
  );

  return router;
}
