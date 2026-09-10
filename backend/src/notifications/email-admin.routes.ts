import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../common/http.js';
import { requireRole } from '../auth/require-auth.middleware.js';
import { NotFoundError } from '../workflow/errors.js';
import type { UserRepository } from '../auth/user.repository.js';
import type { NotificationService } from './notification.service.js';
import type { TemplateService } from './template.service.js';
import type { TriggerService } from './trigger.service.js';

const localeSchema = z.enum(['ar', 'en']);

const draftSchema = z.object({
  name: z.string().min(1).max(120),
  subjectAr: z.string().min(1).max(300),
  subjectEn: z.string().min(1).max(300),
  bodyAr: z.string().min(1).max(20_000),
  bodyEn: z.string().min(1).max(20_000),
  ctaLabelAr: z.string().max(80).nullable().optional(),
  ctaLabelEn: z.string().max(80).nullable().optional(),
  active: z.boolean().optional(),
});

const previewSchema = z.object({
  locale: localeSchema.default('ar'),
  draft: draftSchema.partial().optional(),
});

/** ADMIN — the email template editor. */
export function emailTemplatesRouter(
  templates: TemplateService,
  notifications: NotificationService,
  users: UserRepository,
): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await templates.list());
    }),
  );

  /** Admin creates a brand-new template (key derived from the name). */
  router.post(
    '/',
    validate(draftSchema.extend({ audience: z.enum(['employee', 'staff']) })),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof draftSchema> & { audience: 'employee' | 'staff' };
      res.status(201).json(await templates.create(compact(body), req.actor?.id));
    }),
  );

  router.get(
    '/:key',
    asyncHandler(async (req, res) => {
      res.json(await templates.get(req.params['key'] as string));
    }),
  );

  router.put(
    '/:key',
    validate(draftSchema),
    asyncHandler(async (req, res) => {
      const draft = req.body as z.infer<typeof draftSchema>;
      res.json(await templates.upsert(req.params['key'] as string, compact(draft), req.actor?.id));
    }),
  );

  router.delete(
    '/:key',
    asyncHandler(async (req, res) => {
      await templates.revert(req.params['key'] as string);
      res.status(204).end();
    }),
  );

  router.post(
    '/:key/preview',
    validate(previewSchema),
    asyncHandler(async (req, res) => {
      const { locale, draft } = req.body as z.infer<typeof previewSchema>;
      res.json(await templates.preview(req.params['key'] as string, locale, draft ? compact(draft) : undefined));
    }),
  );

  /** Send the current version to the signed-in admin's own inbox. */
  router.post(
    '/:key/test',
    validate(z.object({ locale: localeSchema.default('ar') })),
    asyncHandler(async (req, res) => {
      const { locale } = req.body as { locale: 'ar' | 'en' };
      const me = req.actor?.id ? await users.findById(req.actor.id) : null;
      if (!me) throw new NotFoundError('user', req.actor?.id ?? '');
      const key = req.params['key'] as string;
      await notifications.notifyExternal(
        me.email,
        key,
        templates.sampleParams(locale),
        { entity: 'TEMPLATE_TEST', entityId: key },
        locale,
      );
      res.json({ sentTo: me.email });
    }),
  );

  return router;
}

const triggerSchema = z.object({
  processKey: z.string().min(1),
  status: z.string().min(1),
  templateKey: z.string().min(1),
  recipient: z.enum(['SUBJECT', 'ROLE']),
  role: z.string().nullable().optional(),
  ccEmails: z.array(z.string().email()).max(10).nullable().optional(),
  active: z.boolean().optional(),
});

/** ADMIN — "when status X, send template Y" rules. */
export function emailTriggersRouter(triggers: TriggerService): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await triggers.list());
    }),
  );

  router.get(
    '/options',
    asyncHandler(async (_req, res) => {
      res.json(await triggers.options());
    }),
  );

  router.post(
    '/',
    validate(triggerSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof triggerSchema>;
      res.status(201).json(await triggers.create(compact(body), req.actor?.id));
    }),
  );

  router.put(
    '/:id',
    validate(triggerSchema.partial()),
    asyncHandler(async (req, res) => {
      // compact() drops undefined keys (partial update) but keeps explicit nulls.
      const body = compact(req.body as Partial<z.infer<typeof triggerSchema>>);
      res.json(await triggers.update(req.params['id'] as string, body));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await triggers.remove(req.params['id'] as string);
      res.status(204).end();
    }),
  );

  return router;
}
