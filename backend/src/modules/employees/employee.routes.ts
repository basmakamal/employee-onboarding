import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { photoUpload, storagePath } from '../../common/storage.js';
import { GuardFailedError } from '../../workflow/errors.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import type { EmployeeService } from './employee.service.js';
import type { OnboardingService } from './onboarding.service.js';
import type { Actor } from '../../workflow/engine.js';

const processActionSchema = z.object({
  holdReason: z.string().optional(),
  holdNote: z.string().optional(),
  certificateStorageKey: z.string().optional(),
});

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'TEMPORARY'] as const;

/**
 * One intake endpoint, two modes: the default opens the onboarding
 * pipeline (data form → contract → activation); `direct: true` adds
 * existing staff already ACTIVE.
 */
const createEmployeeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  birthDate: z.coerce.date().optional(),
  department: z.string().optional(),
  project: z.string().optional(),
  jobTitle: z.string().optional(),
  directManager: z.string().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  hireDate: z.coerce.date().optional(),
  direct: z.boolean().default(false),
  documentTypes: z
    .array(z.string().min(1))
    .min(1)
    .default(['NATIONAL_ID', 'QUALIFICATION', 'PHOTO', 'IBAN_LETTER']),
});

const contractSchema = z.object({
  details: z.record(z.string(), z.unknown()).default({}),
});

const notesSchema = z.object({ notes: z.string().optional() });

const ONBOARDING_ACTIONS: Record<string, 'sendForm' | 'requestMissing' | 'acceptDocuments' | 'sendContract' | 'reopen'> = {
  'send-form': 'sendForm',
  'request-missing': 'requestMissing',
  'accept-documents': 'acceptDocuments',
  'send-contract': 'sendContract',
  reopen: 'reopen',
};

function extOf(mime: string | null): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return (mime && map[mime]) || '';
}

/** Profile edit — every field optional; null clears an optional column. */
const updateEmployeeSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  nationalId: z.string().nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
  department: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  directManager: z.string().nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  hireDate: z.coerce.date().optional(),
});

const createRequestSchema = z.object({
  type: z.enum([
    'SALARY_LETTER',
    'BANK_LETTER',
    'DEPARTMENT_CHANGE',
    'JOB_TITLE_CHANGE',
    'PROMOTION',
    'PROJECT_TRANSFER',
    'WARNING',
    'INVESTIGATION',
  ]),
  notes: z.string().max(2000).optional(),
});

const KINDS = ['gosi', 'medical', 'criminal'] as const;

export function employeeRouter(service: EmployeeService, onboarding: OnboardingService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await service.list());
    }),
  );

  /** New hire (onboarding pipeline) by default; `direct: true` for existing staff. */
  router.post(
    '/',
    requireRole('HR', 'ADMIN'),
    validate(createEmployeeSchema),
    asyncHandler(async (req, res) => {
      const { direct, documentTypes, ...rest } = req.body as z.infer<typeof createEmployeeSchema>;
      const input = compact(rest);
      if (direct) {
        res.status(201).json(await service.createDirect(input, actor(req)));
        return;
      }
      res.status(201).json(
        await onboarding.create(
          { ...input, documentTypes, createdById: actor(req).id ?? '' },
          actor(req),
        ),
      );
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await service.getDetails(req.params['id'] as string, actor(req)));
    }),
  );

  /** Onboarding pipeline actions (BRD stage 1) on the same record. */
  router.post(
    '/:id/actions/:action',
    requireRole('HR', 'ADMIN'),
    validate(notesSchema),
    asyncHandler(async (req, res) => {
      const method = ONBOARDING_ACTIONS[req.params['action'] as string];
      if (!method) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: `unknown action ${req.params['action']}` },
        });
        return;
      }
      const id = req.params['id'] as string;
      const { notes } = req.body as z.infer<typeof notesSchema>;
      if (method === 'requestMissing') {
        res.json(await onboarding.requestMissing(id, actor(req), notes));
        return;
      }
      res.json(await onboarding[method](id, actor(req)));
    }),
  );

  /** Contract draft — editable only during CONTRACT_CREATION. */
  router.put(
    '/:id/contract',
    requireRole('HR', 'ADMIN'),
    validate(contractSchema),
    asyncHandler(async (req, res) => {
      const { details } = req.body as z.infer<typeof contractSchema>;
      res.json(await onboarding.upsertContract(req.params['id'] as string, details as never, actor(req)));
    }),
  );

  /** Onboarding checklist file download (HR review). */
  router.get(
    '/:id/onboarding-documents/:docId/download',
    requireRole('HR', 'ADMIN'),
    asyncHandler(async (req, res) => {
      const doc = await onboarding.getDocument(
        req.params['id'] as string,
        req.params['docId'] as string,
      );
      res.download(storagePath(doc.storageKey as string), `${doc.type}${extOf(doc.mimeType)}`);
    }),
  );

  /** PUT /:id — HR edits the profile (the reference's "edit data" button). */
  router.put(
    '/:id',
    requireRole('HR', 'ADMIN'),
    validate(updateEmployeeSchema),
    asyncHandler(async (req, res) => {
      const input = compact(req.body as z.infer<typeof updateEmployeeSchema>);
      res.json(await service.update(req.params['id'] as string, input, actor(req)));
    }),
  );

  /** Profile photo: upload (HR) and authenticated serving (any staff). */
  router.post(
    '/:id/photo',
    requireRole('HR', 'ADMIN'),
    photoUpload.single('photo'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new GuardFailedError('PHOTO_MISSING', 'no photo uploaded');
      res.json(await service.setPhoto(req.params['id'] as string, req.file.filename, actor(req)));
    }),
  );

  router.get(
    '/:id/photo',
    asyncHandler(async (req, res) => {
      const key = await service.getPhotoKey(req.params['id'] as string);
      res.sendFile(storagePath(key));
    }),
  );

  /** POST /:id/requests — the services grid (salary letter, promotion…). */
  router.post(
    '/:id/requests',
    requireRole('HR', 'ADMIN'),
    validate(createRequestSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createRequestSchema>;
      res
        .status(201)
        .json(
          await service.createRequest(req.params['id'] as string, body.type, actor(req), body.notes),
        );
    }),
  );

  /** POST /:id/processes/:kind/actions/:action — the three process cards. */
  router.post(
    '/:id/processes/:kind/actions/:action',
    validate(processActionSchema),
    asyncHandler(async (req, res) => {
      const kind = req.params['kind'] as (typeof KINDS)[number];
      if (!KINDS.includes(kind)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `unknown process ${kind}` } });
        return;
      }
      const input = compact(req.body as z.infer<typeof processActionSchema>);
      res.json(
        await service.actOnProcess(
          req.params['id'] as string,
          kind,
          (req.params['action'] as string).toUpperCase(),
          actor(req),
          input,
        ),
      );
    }),
  );

  return router;
}
