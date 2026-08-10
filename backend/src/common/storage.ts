import { mkdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { resolve, sep, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { logger } from './logger.js';
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

/**
 * Resolve a stored key to its absolute path — and refuse anything that
 * escapes the upload root, so a corrupted/hostile key can never read
 * outside it.
 */
export function storagePath(storageKey: string): string {
  const abs = resolve(uploadRoot, storageKey);
  if (abs !== uploadRoot && !abs.startsWith(uploadRoot + sep)) {
    throw new GuardFailedError('BAD_STORAGE_KEY', 'storage key escapes the upload root');
  }
  return abs;
}

/**
 * Files are sharded per employee (employees/{id}/{uuid}.ext) instead of one
 * flat directory — 100k employees × several files each would otherwise pile
 * hundreds of thousands of entries into a single folder.
 */
export function employeeSubdir(employeeId: string): string {
  // cuid/uuid-shaped only — the id becomes a path segment.
  if (!/^[A-Za-z0-9-]+$/.test(employeeId)) {
    throw new GuardFailedError('BAD_ID', 'invalid employee id');
  }
  return posix.join('employees', employeeId);
}

/** Compose the storage key for a file multer just wrote into `subdir`. */
export function storageKeyFor(subdir: string, filename: string): string {
  return posix.join(subdir, filename);
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by a route middleware BEFORE multer runs — where uploads land. */
    uploadSubdir?: string;
  }
}

/**
 * Disk storage that shards into the request's `uploadSubdir` (set by route
 * middleware after it has authenticated the request — files are never
 * written for an unverified caller) with random server-side filenames.
 */
function shardedStorage(mimeMap: Record<string, string>) {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      if (!req.uploadSubdir) {
        cb(new GuardFailedError('UPLOAD_TARGET_MISSING', 'upload destination not resolved'), '');
        return;
      }
      const dir = resolve(uploadRoot, req.uploadSubdir);
      try {
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${mimeMap[file.mimetype] ?? ''}`);
    },
  });
}

/**
 * Multer instance for onboarding document uploads: whitelist by MIME,
 * 10 MB per file, random server-side filenames (never the client's).
 */
export const documentUpload = multer({
  storage: shardedStorage(ALLOWED_MIME),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) cb(null, true);
    else cb(new GuardFailedError('UNSUPPORTED_FILE_TYPE', `file type ${file.mimetype} not allowed`));
  },
});

const PHOTO_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** Profile photos: images only, 5 MB, one file. */
export const photoUpload = multer({
  storage: shardedStorage(PHOTO_MIME),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (PHOTO_MIME[file.mimetype]) cb(null, true);
    else cb(new GuardFailedError('UNSUPPORTED_FILE_TYPE', `file type ${file.mimetype} not allowed`));
  },
});

// ---------------------------------------------------------------------------
// Content sniffing — the client's declared MIME type is just a header; the
// magic bytes are what the file actually is. A renamed executable must not
// pass as a PDF.
// ---------------------------------------------------------------------------

const SIGNATURES: Record<string, Array<readonly number[]>> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  // .docx is a ZIP container (PK…), .doc an OLE compound file.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    [0x50, 0x4b, 0x03, 0x04],
  ],
  'application/msword': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

async function matchesSignature(path: string, mimetype: string): Promise<boolean> {
  const expected = SIGNATURES[mimetype];
  if (!expected) return false; // unknown type — the whitelist should have caught it
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(8), 0, 8, 0);
    return expected.some(
      (sig) => bytesRead >= sig.length && sig.every((byte, i) => buffer[i] === byte),
    );
  } finally {
    await handle.close();
  }
}

/**
 * Verify every uploaded file's magic bytes against its declared MIME type.
 * On any mismatch ALL files from the request are removed and the request is
 * rejected — a multipart batch is accepted or refused as a whole.
 */
export async function verifyUploadedFiles(files: Express.Multer.File[]): Promise<void> {
  for (const file of files) {
    const ok = await matchesSignature(file.path, file.mimetype).catch(() => false);
    if (!ok) {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
      throw new GuardFailedError(
        'FILE_SIGNATURE_MISMATCH',
        `${file.originalname || file.fieldname}: content does not match its declared type`,
      );
    }
  }
}

/** Best-effort disk removal — a missing file is fine, anything else is logged. */
export async function removeStoredFile(storageKey: string): Promise<void> {
  try {
    await unlink(storagePath(storageKey));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger.warn({ err, storageKey }, 'could not remove stored file');
  }
}

export async function removeStoredFiles(storageKeys: string[]): Promise<void> {
  await Promise.all(storageKeys.map((key) => removeStoredFile(key)));
}

/** Remove files multer already wrote for a request that then failed. */
export async function discardUploads(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
}
