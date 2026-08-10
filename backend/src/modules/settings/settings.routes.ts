import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import { calendarSchema, mailSettingsSchema, type SettingsService } from './settings.service.js';
import type { SlaRuleRepository, HolidayRepository } from '../../workflow/sla-rule.repository.js';
import type { OwnershipService } from '../../workflow/ownership.service.js';
import { generateSaudiHolidays } from '../../workflow/saudi-holidays.js';

const holidaySchema = z.object({
  date: z.coerce.date(),
  name: z.string().min(1),
});

const testSchema = z.object({ to: z.string().email() });

const ruleUpdateSchema = z.object({
  afterValue: z.number().int().positive().optional(),
  afterUnit: z.enum(['HOURS', 'CALENDAR_DAYS', 'WORKING_DAYS']).optional(),
  notifySubject: z.boolean().optional(),
  notifyHr: z.boolean().optional(),
  notifyRole: z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN']).optional(),
  escalateToRole: z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN']).nullable().optional(),
  active: z.boolean().optional(),
});

const ownershipSchema = z.object({
  roles: z.array(z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'])).min(1),
});

/** Only machines with a registered scheduler watcher may be watched. */
const WATCHED_PROCESS_KEYS = [
  'EMPLOYEE',
  'OFFBOARDING',
  'GOSI',
  'MEDICAL_INSURANCE',
  'DOCUMENT_EXPIRY',
] as const;

const ruleCreateSchema = z.object({
  processKey: z.enum(WATCHED_PROCESS_KEYS),
  status: z.string().min(1).max(64),
  afterValue: z.number().int().positive(),
  afterUnit: z.enum(['HOURS', 'CALENDAR_DAYS', 'WORKING_DAYS']),
  action: z.enum(['REMIND', 'REMIND_DAILY', 'ESCALATE', 'EXPIRE']),
  notifySubject: z.boolean().default(false),
  notifyRole: z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN']).default('HR'),
  escalateToRole: z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN']).nullable().optional(),
  active: z.boolean().default(true),
});

/** ADMIN-only system settings. */
export function settingsRouter(
  service: SettingsService,
  slaRules: SlaRuleRepository,
  ownership: OwnershipService,
  holidays: HolidayRepository,
): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  // ---- Work calendar: weekend days + public holidays ----
  router.get(
    '/calendar',
    asyncHandler(async (_req, res) => {
      res.json({ ...(await service.getCalendar()), holidays: await holidays.list() });
    }),
  );

  router.put(
    '/calendar',
    validate(calendarSchema),
    asyncHandler(async (req, res) => {
      res.json(await service.updateCalendar(req.body as z.infer<typeof calendarSchema>));
    }),
  );

  router.post(
    '/holidays',
    validate(holidaySchema),
    asyncHandler(async (req, res) => {
      const { date, name } = req.body as z.infer<typeof holidaySchema>;
      res.status(201).json(await holidays.add(date, name));
    }),
  );

  router.delete(
    '/holidays/:id',
    asyncHandler(async (req, res) => {
      await holidays.remove(req.params['id'] as string);
      res.status(204).end();
    }),
  );

  /** Auto-fill a year with the official Saudi public holidays. */
  router.post(
    '/holidays/generate',
    validate(z.object({ year: z.number().int().min(2020).max(2100) })),
    asyncHandler(async (req, res) => {
      const { year } = req.body as { year: number };
      const existing = new Set(
        (await holidays.list()).map((h) => h.date.toISOString().slice(0, 10)),
      );
      let created = 0;
      for (const holiday of generateSaudiHolidays(year)) {
        if (existing.has(holiday.date.toISOString().slice(0, 10))) continue;
        await holidays.add(holiday.date, holiday.name);
        created += 1;
      }
      res.json({ created });
    }),
  );

  // ---- Status ownership (which group handles which status) ----
  router.get(
    '/ownership',
    asyncHandler(async (_req, res) => {
      res.json(await ownership.list());
    }),
  );

  router.put(
    '/ownership/:id',
    validate(ownershipSchema),
    asyncHandler(async (req, res) => {
      const { roles } = req.body as z.infer<typeof ownershipSchema>;
      res.json(await ownership.update(req.params['id'] as string, roles));
    }),
  );

  // ---- Automation (SLA) rules ----
  router.get(
    '/sla',
    asyncHandler(async (_req, res) => {
      res.json(await slaRules.list());
    }),
  );

  /** Create a new automation rule (watcher) from the admin screen. */
  router.post(
    '/sla',
    validate(ruleCreateSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof ruleCreateSchema>;
      res.status(201).json(
        await slaRules.create({
          processKey: body.processKey,
          status: body.status,
          afterValue: body.afterValue,
          afterUnit: body.afterUnit,
          action: body.action,
          notifySubject: body.notifySubject,
          notifyRole: body.notifyRole,
          escalateToRole: body.escalateToRole ?? null,
          active: body.active,
        }),
      );
    }),
  );

  router.put(
    '/sla/:id',
    validate(ruleUpdateSchema),
    asyncHandler(async (req, res) => {
      const changes = req.body as z.infer<typeof ruleUpdateSchema>;
      res.json(
        await slaRules.update(req.params['id'] as string, {
          ...compact(changes),
          // nullable escalateToRole must survive compact()
          ...(changes.escalateToRole === null ? { escalateToRole: null } : {}),
        }),
      );
    }),
  );

  router.get(
    '/mail',
    asyncHandler(async (_req, res) => {
      res.json(await service.getMailSettingsMasked());
    }),
  );

  router.put(
    '/mail',
    validate(mailSettingsSchema),
    asyncHandler(async (req, res) => {
      await service.updateMailSettings(req.body as never);
      res.json(await service.getMailSettingsMasked());
    }),
  );

  router.post(
    '/mail/test',
    validate(testSchema),
    asyncHandler(async (req, res) => {
      const { to } = req.body as z.infer<typeof testSchema>;
      await service.sendTest(to);
      res.json({ ok: true });
    }),
  );

  return router;
}
