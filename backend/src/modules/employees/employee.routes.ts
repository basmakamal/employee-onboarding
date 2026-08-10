import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, pagedQuery, validate, validateQuery } from '../../common/http.js';
import {
  EMPLOYEE_SORT_FIELDS,
  type EmployeeListQuery,
} from './employee.repository.js';
import {
  discardUploads,
  employeeSubdir,
  photoUpload,
  removeStoredFile,
  removeStoredFiles,
  storageKeyFor,
  storagePath,
  verifyUploadedFiles,
} from '../../common/storage.js';
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
  /** Onboarding mode: e-mail the signed data-form link right after creation. */
  sendForm: z.boolean().default(true),
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

const EMPLOYEE_STATUSES = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
  'ACTIVE',
  'INACTIVE',
] as const;

/** List query: everything optional, everything clamped server-side. */
const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  filter: z.enum(['all', 'onboarding', 'active', 'inactive']).default('all'),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  basis: z.enum(['hireDate', 'createdAt']).default('hireDate'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(EMPLOYEE_SORT_FIELDS).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function employeeRouter(service: EmployeeService, onboarding: OnboardingService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  /** Server-side paged list: { items, total, counts }. */
  router.get(
    '/',
    validateQuery(listQuerySchema),
    asyncHandler(async (req, res) => {
      res.json(await service.list(pagedQuery<EmployeeListQuery>(req)));
    }),
  );

  /** New hire (onboarding pipeline) by default; `direct: true` for existing staff. */
  router.post(
    '/',
    requireRole('HR', 'ADMIN'),
    validate(createEmployeeSchema),
    asyncHandler(async (req, res) => {
      const { direct, sendForm, documentTypes, ...rest } = req.body as z.infer<
        typeof createEmployeeSchema
      >;
      const input = compact(rest);
      if (direct) {
        res.status(201).json(await service.createDirect(input, actor(req)));
        return;
      }
      const employee = await onboarding.create(
        { ...input, documentTypes, createdById: actor(req).id ?? '' },
        actor(req),
      );
      // Default UX: the data-form e-mail goes out immediately on creation.
      const link = sendForm ? await onboarding.sendForm(employee.id, actor(req)) : null;
      res.status(201).json({ ...employee, formLink: link });
    }),
  );

  /** Distinct departments / job titles for the form comboboxes.
   *  Registered BEFORE /:id so "options" is never parsed as an id. */
  router.get(
    '/options',
    asyncHandler(async (_req, res) => {
      res.json(await service.fieldOptions());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await service.getDetails(req.params['id'] as string, actor(req)));
    }),
  );

  /** Older timeline pages — the detail payload carries only the latest 20. */
  router.get(
    '/:id/audit',
    validateQuery(auditQuerySchema),
    asyncHandler(async (req, res) => {
      const { page, limit } = pagedQuery<{ page: number; limit: number }>(req);
      res.json(await service.auditPage(req.params['id'] as string, page, limit));
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

  /** DELETE /:id — ADMIN-only hard delete with full child cleanup. */
  router.delete(
    '/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const storageKeys = await service.remove(req.params['id'] as string, actor(req));
      // Disk cleanup only after the delete committed — files first would
      // leave a live record pointing at nothing if the delete failed.
      await removeStoredFiles(storageKeys);
      res.status(204).end();
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
    (req, _res, next) => {
      // Shard the photo into the employee's directory before multer runs.
      req.uploadSubdir = employeeSubdir(req.params['id'] as string);
      next();
    },
    photoUpload.single('photo'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new GuardFailedError('PHOTO_MISSING', 'no photo uploaded');
      try {
        await verifyUploadedFiles([req.file]);
        const key = storageKeyFor(req.uploadSubdir as string, req.file.filename);
        const { photoKey, previousKey } = await service.setPhoto(
          req.params['id'] as string,
          key,
          actor(req),
        );
        // The replaced photo is unreferenced once the update committed.
        if (previousKey && previousKey !== photoKey) await removeStoredFile(previousKey);
        res.json({ photoKey });
      } catch (err) {
        await discardUploads([req.file]);
        throw err;
      }
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
