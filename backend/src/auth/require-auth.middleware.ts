import type { RequestHandler } from 'express';
import type { AuthService } from './auth.service.js';
import type { Actor } from '../workflow/engine.js';
import { UnauthorizedError } from '../workflow/errors.js';
import { asyncHandler } from '../common/http.js';
import { documented } from '../docs/route-doc.js';

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

/**
 * JWT authentication for staff routes. The actor carries everything the
 * authorisation layer needs — role codes, permissions, the validated
 * active company and the scope inside it — resolved once per request from
 * the user's assignments. Route gates live in auth/authz/authorize.ts.
 */
export function requireAuth(auth: AuthService): RequestHandler {
  return documented(asyncHandler(async (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedError();

    const user = await auth.authenticate(token);
    req.actor = {
      type: 'USER',
      id: user.id,
      role: user.role,
      roles: user.roles,
      permissions: user.permissions,
      ...(user.activeCompany ? { companyId: user.activeCompany.id } : {}),
      scope: user.scope,
    };
    next();
  }), { auth: true });
}
