import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { GuardFailedError } from '../workflow/errors.js';

/** Absolute upload root — outside the webroot, gitignored. */
export const uploadRoot = resolve(config.UPLOAD_DIR);
mkdirSync(uploadRoot, { recursive: true });

const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export function storagePath(storageKey: string): string {
  return resolve(uploadRoot, storageKey);
}

/**
 * Multer instance for trainee document uploads: whitelist by MIME,
 * 10 MB per file, random server-side filenames (never the client's).
 */
export const documentUpload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${ALLOWED_MIME[file.mimetype] ?? ''}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) cb(null, true);
    else cb(new GuardFailedError('UNSUPPORTED_FILE_TYPE', `file type ${file.mimetype} not allowed`));
  },
});
