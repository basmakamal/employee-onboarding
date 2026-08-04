import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { storagePath } from '../../common/storage.js';
import type { TraineeService } from './trainee.service.js';
import type { Actor } from '../../workflow/engine.js';

const createTraineeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  birthDate: z.coerce.date().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  /** HR-configurable checklist; sensible default for new hires. */
  documentTypes: z
    .array(z.string().min(1))
    .min(1)
    .default(['NATIONAL_ID', 'QUALIFICATION', 'PHOTO', 'IBAN_LETTER']),
});

const contractSchema = z.object({
  details: z.record(z.string(), z.unknown()).default({}),
});

const notesSchema = z.object({ notes: z.string().optional() });

/** Staff endpoints (behind the actor middleware). */
export function traineeRouter(service: TraineeService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await service.list());
    }),
  );

  router.post(
    '/',
    validate(createTraineeSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof createTraineeSchema>;
      const trainee = await service.create(
        compact({ ...input, createdById: actor(req).id ?? '' }),
        actor(req),
      );
      res.status(201).json(trainee);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await service.get(req.params['id'] as string, actor(req)));
    }),
  );

  router.post(
    '/:id/actions/send-form',
    asyncHandler(async (req, res) => {
      res.json(await service.sendForm(req.params['id'] as string, actor(req)));
    }),
  );

  router.post(
    '/:id/actions/request-missing',
    validate(notesSchema),
    asyncHandler(async (req, res) => {
      const { notes } = req.body as z.infer<typeof notesSchema>;
      res.json(await service.requestMissing(req.params['id'] as string, actor(req), notes));
    }),
  );

  router.post(
    '/:id/actions/accept-documents',
    asyncHandler(async (req, res) => {
      res.json(await service.acceptDocuments(req.params['id'] as string, actor(req)));
    }),
  );

  router.put(
    '/:id/contract',
    validate(contractSchema),
    asyncHandler(async (req, res) => {
      const { details } = req.body as z.infer<typeof contractSchema>;
      res.json(
        await service.upsertContract(
          req.params['id'] as string,
          details as never,
          actor(req),
        ),
      );
    }),
  );

  router.post(
    '/:id/actions/send-contract',
    asyncHandler(async (req, res) => {
      res.json(await service.sendContract(req.params['id'] as string, actor(req)));
    }),
  );

  router.post(
    '/:id/actions/reopen',
    asyncHandler(async (req, res) => {
      res.json(await service.reopen(req.params['id'] as string, actor(req)));
    }),
  );

  router.get(
    '/:id/documents/:docId/download',
    asyncHandler(async (req, res) => {
      const doc = await service.getDocument(
        req.params['id'] as string,
        req.params['docId'] as string,
      );
      res.download(storagePath(doc.storageKey as string), `${doc.type}${extOf(doc.mimeType)}`);
    }),
  );

  return router;
}

function extOf(mime: string | null): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return map[mime ?? ''] ?? '';
}
