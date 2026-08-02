import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { DomainError } from '../workflow/errors.js';
import { logger } from './logger.js';

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
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

/**
 * Central error handler — the ONLY place errors become HTTP responses.
 * Typed domain errors carry their own status; Zod errors are 400 with
 * field details; anything else is a logged 500 with no leaked internals.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'invalid request body',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  (req.log ?? logger).error(err ?? {}, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'internal server error' } });
}
