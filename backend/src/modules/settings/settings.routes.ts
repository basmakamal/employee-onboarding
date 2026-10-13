import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import { calendarSchema, mailSettingsSchema, type SettingsService } from './settings.service.js';
import type { SlaRuleRepository, HolidayRepository } from '../../workflow/sla-rule.repository.js';
import type { OwnershipService } from '../../workflow/ownership.service.js';
import {
  RESPONSIBILITY_KEYS,
  type ResponsibilityService,
} from '../../workflow/responsibility.service.js';
import { generateSaudiHolidays } from '../../workflow/saudi-holidays.js';
import type { NotificationGroupRepository } from '../../notifications/notification-group.repository.js';
import { MACHINE_STATUSES } from '../../notifications/template-catalog.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';

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
  // null = back to the watcher's built-in template
  subjectTemplateKey: z.string().max(80).nullable().optional(),
  staffTemplateKey: z.string().max(80).nullable().optional(),
  ccEmails: z.array(z.string().email()).max(10).nullable().optional(),
  active: z.boolean().optional(),
});

const ownershipSchema = z.object({
  roles: z.array(z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'])).min(1),
});

const responsibilitySchema = z.object({
  userIds: z.array(z.string().min(1)).max(20),
});

// ---- Responsible teams ----
const groupSchema = z.object({
  /** Stable handle, e.g. EMPLOYMENT_CONTRACT — upper-case letters, digits, underscores. */
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/),
  nameAr: z.string().min(1).max(120),
  nameEn: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const membersSchema = z.object({
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        email: z.string().email(),
        userId: z.string().min(1).nullable().optional(),
      }),
    )
    .max(50),
});

const assignmentsSchema = z.object({
  assignments: z
    .array(z.object({ processKey: z.string().min(1), status: z.string().min(1) }))
    .max(200),
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
  subjectTemplateKey: z.string().max(80).nullable().optional(),
  staffTemplateKey: z.string().max(80).nullable().optional(),
  ccEmails: z.array(z.string().email()).max(10).nullable().optional(),
  active: z.boolean().default(true),
});

/** ADMIN-only system settings. */
export function settingsRouter(
  service: SettingsService,
  slaRules: SlaRuleRepository,
  ownership: OwnershipService,
  holidays: HolidayRepository,
  responsibility: ResponsibilityService,
  groups?: NotificationGroupRepository,
): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  // ---- Responsible teams: named people per status (notifications) ----
  if (groups) {
    const mustFind = async (id: string) => {
      const row = await groups.findById(id);
      if (!row) throw new NotFoundError('team', id);
      return row;
    };

    router.get(
      '/groups',
      asyncHandler(async (_req, res) => {
        res.json(await groups.list());
      }),
    );

    router.post(
      '/groups',
      validate(groupSchema),
      asyncHandler(async (req, res) => {
        const body = req.body as z.infer<typeof groupSchema>;
        if (await groups.findByKey(body.key)) {
          throw new GuardFailedError('DUPLICATE_KEY', `a team with key ${body.key} already exists`);
        }
        res.status(201).json(await groups.create(body));
      }),
    );

    router.put(
      '/groups/:id',
      validate(groupSchema.omit({ key: true }).partial()),
      asyncHandler(async (req, res) => {
        const id = req.params['id'] as string;
        await mustFind(id);
        res.json(await groups.update(id, req.body as Partial<z.infer<typeof groupSchema>>));
      }),
    );

    router.delete(
      '/groups/:id',
      asyncHandler(async (req, res) => {
        const id = req.params['id'] as string;
        await mustFind(id);
        await groups.remove(id);
        res.status(204).end();
      }),
    );

    /** Replace the member list — the UI edits the list as a whole. */
    router.put(
      '/groups/:id/members',
      validate(membersSchema),
      asyncHandler(async (req, res) => {
        const id = req.params['id'] as string;
        await mustFind(id);
        const { members } = req.body as z.infer<typeof membersSchema>;
        res.json(await groups.replaceMembers(id, members));
      }),
    );

    /** Replace the statuses this team follows up. */
    router.put(
      '/groups/:id/assignments',
      validate(assignmentsSchema),
      asyncHandler(async (req, res) => {
        const id = req.params['id'] as string;
        await mustFind(id);
        const { assignments } = req.body as z.infer<typeof assignmentsSchema>;
        for (const a of assignments) {
          if (!MACHINE_STATUSES[a.processKey]?.includes(a.status)) {
            throw new GuardFailedError('BAD_STATUS', `${a.status} is not a status of ${a.processKey}`);
          }
        }
        res.json(await groups.replaceAssignments(id, assignments));
      }),
    );
  }

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

  // ---- Primary follow-up owners per process (notifications only) ----
  router.get(
    '/responsibility',
    asyncHandler(async (_req, res) => {
      res.json(await responsibility.all());
    }),
  );

  router.put(
    '/responsibility/:processKey',
    validate(responsibilitySchema),
    asyncHandler(async (req, res) => {
      const key = z.enum(RESPONSIBILITY_KEYS).parse(req.params['processKey']);
      const { userIds } = req.body as z.infer<typeof responsibilitySchema>;
      await responsibility.set(key, userIds);
      res.json(await responsibility.all());
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
          subjectTemplateKey: body.subjectTemplateKey ?? null,
          staffTemplateKey: body.staffTemplateKey ?? null,
          ccEmails: body.ccEmails?.length ? body.ccEmails.join(',') : null,
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
          ...compact({ ...changes, ccEmails: undefined }),
          // nullable fields must survive compact(); cc list is stored comma-separated
          ...(changes.escalateToRole === null ? { escalateToRole: null } : {}),
          ...(changes.ccEmails !== undefined
            ? { ccEmails: changes.ccEmails?.length ? changes.ccEmails.join(',') : null }
            : {}),
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
