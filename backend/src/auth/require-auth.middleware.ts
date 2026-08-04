import type { RequestHandler } from 'express';
import type { AuthService } from './auth.service.js';
import type { Actor } from '../workflow/engine.js';
import type { Role } from '../generated/prisma/enums.js';
import { ForbiddenError, UnauthorizedError } from '../workflow/errors.js';
import { asyncHandler } from '../common/http.js';

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

/**
 * JWT authentication for staff routes. Replaces the Phase E header stub —
 * same `req.actor` shape, so services and machines are untouched.
 */
export function requireAuth(auth: AuthService): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedError();

    const user = await auth.authenticate(token);
    req.actor = { type: 'USER', id: user.id, role: user.role };
    next();
  });
}

/** Role gate — run AFTER requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.actor?.role as Role | undefined;
    if (!role || !roles.includes(role)) {
      next(new ForbiddenError(`requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
