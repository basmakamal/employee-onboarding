import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../common/http.js';
import { GuardFailedError, NotFoundError, UnauthorizedError } from '../workflow/errors.js';
import type { AuthService } from './auth.service.js';
import { requireAuth } from './require-auth.middleware.js';
import { config } from '../common/config.js';
import {
  discardUploads,
  photoUpload,
  removeStoredFile,
  storageKeyFor,
  storagePath,
  verifyUploadedFiles,
} from '../common/storage.js';

const profileSchema = z.object({ name: z.string().trim().min(1).max(120) });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
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
 * /api/auth — login, silent refresh, logout, me, change-password.
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

  /** The signed-in person edits their own profile (display name). */
  router.put(
    '/me',
    requireAuth(auth),
    validate(profileSchema),
    asyncHandler(async (req, res) => {
      const { name } = req.body as z.infer<typeof profileSchema>;
      res.json({ user: await auth.updateProfile(req.actor?.id ?? '', { name }) });
    }),
  );

  /** Own profile picture: upload (JPEG/PNG, sniffed) and authenticated serving. */
  router.post(
    '/me/photo',
    requireAuth(auth),
    (req, _res, next) => {
      req.uploadSubdir = `users/${req.actor?.id ?? 'unknown'}`;
      next();
    },
    photoUpload.single('photo'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new GuardFailedError('PHOTO_MISSING', 'no photo uploaded');
      try {
        await verifyUploadedFiles([req.file]);
        const key = storageKeyFor(req.uploadSubdir as string, req.file.filename);
        const { user, previousKey } = await auth.setPhoto(req.actor?.id ?? '', key);
        if (previousKey && previousKey !== key) await removeStoredFile(previousKey);
        res.json({ user });
      } catch (err) {
        await discardUploads([req.file]);
        throw err;
      }
    }),
  );

  router.get(
    '/me/photo',
    requireAuth(auth),
    asyncHandler(async (req, res) => {
      const key = await auth.photoKeyOf(req.actor?.id ?? '');
      if (!key) throw new NotFoundError('photo', req.actor?.id ?? '');
      res.sendFile(storagePath(key));
    }),
  );

  /** The signed-in person replaces a temporary (or old) password with their own. */
  router.post(
    '/change-password',
    requireAuth(auth),
    validate(changePasswordSchema),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
      const user = await auth.changePassword(req.actor?.id ?? '', currentPassword, newPassword);
      res.json({ user });
    }),
  );

  return router;
}
