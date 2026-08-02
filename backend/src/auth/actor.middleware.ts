import type { RequestHandler } from 'express';
import type { Actor } from '../workflow/engine.js';
import type { UserRepository } from './user.repository.js';
import { NotFoundError } from '../workflow/errors.js';
import { asyncHandler } from '../common/http.js';

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

/**
 * DEV-ONLY staff identity: resolves the acting user from the
 * `x-user-email` header (default: hr@example.com).
 *
 * Phase F replaces this middleware with JWT authentication — the rest of
 * the stack already consumes the same `req.actor` shape, so nothing else
 * changes when real auth lands.
 */
export function actorFromHeader(users: UserRepository): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const email = (req.header('x-user-email') ?? 'hr@example.com').toLowerCase();
    const user = await users.findByEmail(email);
    if (!user || !user.active) throw new NotFoundError('user', email);
    req.actor = { type: 'USER', id: user.id, role: user.role };
    next();
  });
}
