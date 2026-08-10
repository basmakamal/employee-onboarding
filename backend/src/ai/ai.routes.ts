import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, validate } from '../common/http.js';
import { requireRole } from '../auth/require-auth.middleware.js';
import { GuardFailedError } from '../workflow/errors.js';
import type { AiService } from './ai.service.js';

const letterSchema = z.object({
  employeeId: z.string().min(1),
  type: z.string().min(1).max(64),
  notes: z.string().max(2000).optional(),
  locale: z.enum(['ar', 'en']).optional(),
});

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

/** Extraction uploads never touch disk — read, extract, discard. */
const documentScan = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) cb(null, true);
    else cb(new GuardFailedError('UNSUPPORTED_FILE_TYPE', `file type ${file.mimetype} not allowed`));
  },
});

/** AI features — HR/ADMIN only, all read-only against the database. */
export function aiRouter(service: AiService): Router {
  const router = Router();
  router.use(requireRole('HR', 'ADMIN'));

  router.post(
    '/letters',
    validate(letterSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof letterSchema>;
      res.json(
        await service.generateLetter({
          employeeId: body.employeeId,
          type: body.type,
          ...(body.notes ? { notes: body.notes } : {}),
          ...(body.locale ? { locale: body.locale } : {}),
        }),
      );
    }),
  );

  router.post(
    '/chat',
    validate(chatSchema),
    asyncHandler(async (req, res) => {
      const { messages } = req.body as z.infer<typeof chatSchema>;
      res.json(await service.chat(messages));
    }),
  );

  router.post(
    '/extract-document',
    documentScan.single('document'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new GuardFailedError('FILE_MISSING', 'no document uploaded');
      res.json(
        await service.extractDocument({ buffer: req.file.buffer, mimeType: req.file.mimetype }),
      );
    }),
  );

  return router;
}
