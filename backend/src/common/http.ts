import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { DomainError, GuardFailedError } from '../workflow/errors.js';
import { logger } from './logger.js';
import { documented } from '../docs/route-doc.js';

/**
 * Strip keys whose value is `undefined` — bridges Zod optionals
 * (`string | undefined`) to exactOptionalPropertyTypes-strict inputs.
 */
export function compact<T extends object>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/** Express 4 does not catch async errors — this wrapper forwards them. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Validate req.body against a Zod schema; the parsed value replaces it. */
export function validate(schema: ZodType): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
  return documented(handler, { body: schema });
}

/**
 * Parse req.query against a Zod schema (coercions, defaults, whitelists) and
 * stash the typed result on req.pagedQuery — query strings are all strings,
 * so every consumer needs the same coerce-and-clamp treatment.
 */
export function validateQuery(schema: ZodType): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    (req as { pagedQuery?: unknown }).pagedQuery = schema.parse(req.query);
    next();
  };
  return documented(handler, { query: schema });
}

/** The query parsed by validateQuery, typed at the call site. */
export function pagedQuery<T>(req: unknown): T {
  return (req as { pagedQuery: T }).pagedQuery;
}

/**
 * Central error handler — the ONLY place errors become HTTP responses.
 * Typed domain errors carry their own status; Zod errors are 400 with
 * field details; anything else is a logged 500 with no leaked internals.
 */
/**
 * One field-level problem in a refused request. `code` is stable and
 * translatable (Zod issue code, or a business-rule code); `params` carries
 * the numbers a message needs ("at most {max} characters"); `message` is an
 * English fallback for logs and API clients.
 */
export interface FieldIssue {
  path: string;
  code: string;
  message: string;
  params?: Record<string, string | number>;
}

function issueOf(i: ZodError['issues'][number]): FieldIssue {
  const params: Record<string, string | number> = {};
  const raw = i as unknown as Record<string, unknown>;
  for (const key of ['minimum', 'maximum', 'expected', 'received', 'validation']) {
    const v = raw[key];
    if (typeof v === 'string' || typeof v === 'number') params[key] = v;
    else if (typeof v === 'bigint') params[key] = Number(v);
  }
  if (i.code === 'too_small' || i.code === 'too_big') params['type'] = String(raw['type'] ?? '');
  if (i.code === 'invalid_string' && typeof raw['validation'] === 'string') params['validation'] = raw['validation'];
  // "Required": a missing value surfaces as invalid_type received undefined.
  const code = i.code === 'invalid_type' && raw['received'] === 'undefined' ? 'required' : i.code;
  return { path: i.path.join('.'), code, message: i.message, ...(Object.keys(params).length ? { params } : {}) };
}

/** Prisma's known request errors, recognised without importing the generated runtime. */
function prismaCode(err: unknown): { code: string; target?: string[] } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; meta?: { target?: unknown; field_name?: unknown } };
  if (typeof e.code !== 'string' || !/^P\d{4}$/.test(e.code)) return null;
  const target = Array.isArray(e.meta?.target)
    ? (e.meta?.target as string[])
    : typeof e.meta?.target === 'string'
      ? [e.meta.target as string]
      : undefined;
  return { code: e.code, ...(target ? { target } : {}) };
}

/**
 * Every refusal leaves here with a stable `code` the UI translates, and —
 * for input problems — the field it belongs to. Nothing technical (SQL,
 * stack, paths) reaches the client; the detail is logged instead.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof DomainError) {
    // A business rule about one input carries it as a field issue too, so the
    // form can outline that field and not just show the sentence.
    const field = err instanceof GuardFailedError ? err.field : undefined;
    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        ...(field ? { details: [{ path: field, code: err.code, message: err.message }] } : {}),
      },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'some fields are missing or invalid',
        details: err.issues.map(issueOf),
      },
    });
    return;
  }
  // Malformed JSON body (express.json) — the client's fault, not a crash.
  if (err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'the request could not be read' } });
    return;
  }
  // Uploads over the size / count limits (multer).
  const multer = err as { name?: string; code?: string; field?: string };
  if (multer?.name === 'MulterError') {
    const tooLarge = multer.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_REJECTED',
        message: tooLarge ? 'the file is larger than the allowed size' : 'the upload was rejected',
        ...(multer.field ? { details: [{ path: multer.field, code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_REJECTED', message: 'upload rejected' }] } : {}),
      },
    });
    return;
  }
  // Database constraints the services did not pre-check (races, edge cases).
  const prisma = prismaCode(err);
  if (prisma?.code === 'P2002') {
    const field = (prisma.target ?? []).filter((t) => t !== 'companyId').at(-1);
    res.status(409).json({
      error: {
        code: 'DUPLICATE',
        message: 'a record with this value already exists',
        ...(field ? { details: [{ path: field, code: 'DUPLICATE', message: 'already exists' }] } : {}),
      },
    });
    return;
  }
  if (prisma?.code === 'P2003' || prisma?.code === 'P2014') {
    res.status(409).json({ error: { code: 'IN_USE', message: 'this record is still referenced by other records' } });
    return;
  }
  if (prisma?.code === 'P2025') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'the requested record could not be found' } });
    return;
  }
  (req.log ?? logger).error(err ?? {}, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'something went wrong — please try again' } });
}
