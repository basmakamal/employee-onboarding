import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../common/http.js';
import { UnauthorizedError } from '../workflow/errors.js';
import type { AuthService } from './auth.service.js';
import { requireAuth } from './require-auth.middleware.js';
import { config } from '../common/config.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_COOKIE = 'refresh_token';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, // JS can never read it
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/api/auth', // only sent to auth endpoints
    maxAge: 7 * 24 * 3_600_000,
  });
}

/**
 * /api/auth — login, silent refresh, logout, me.
 * Access token: short-lived, returned in the body, held in SPA memory.
 * Refresh token: httpOnly cookie scoped to /api/auth, rotated on use.
 */
export function authRouter(auth: AuthService): Router {
  const router = Router();

  router.post(
    '/login',
    validate(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof loginSchema>;
      const result = await auth.login(email, password);
      setRefreshCookie(res, result.refreshToken);
      res.json({ user: result.user, accessToken: result.accessToken });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
      if (!token) throw new UnauthorizedError('no refresh token');
      const result = await auth.refresh(token);
      setRefreshCookie(res, result.refreshToken);
      res.json({ user: result.user, accessToken: result.accessToken });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      // Kill the refresh token server-side too (no-op without Redis).
      await auth.logout((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    requireAuth(auth),
    asyncHandler(async (req, res) => {
      res.json({ actor: req.actor });
    }),
  );

  return router;
}
