/**
 * The generalized SLA scheduler — watchers + sla_firings memory, exercised
 * with fakes and a controlled clock (2026-08-02 is a Sunday, a working day).
 */
import { describe, expect, it, vi } from 'vitest';
import { SlaScheduler, type SlaWatcher, type WatchedRecord } from '../src/workflow/sla-scheduler.js';
import type { SlaRule } from '../src/generated/prisma/client.js';

const NOW = new Date('2026-08-02T12:00:00Z');

function rule(overrides: Partial<SlaRule>): SlaRule {
  return {
    id: 'rule1',
    companyId: 'co-a',
    processKey: 'EMPLOYEE',
    status: 'AWAITING_FORM',
    afterValue: 24,
    afterUnit: 'HOURS',
    action: 'REMIND',
    notifySubject: true,
    notifyHr: true,
    notifyRole: 'HR',
    escalateToRole: null,
    active: true,
    createdAt: NOW,
    ...overrides,
  } as SlaRule;
}

function record(overrides: Partial<WatchedRecord> = {}): WatchedRecord {
  return {
    id: 'e1',
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    anchorAt: new Date('2026-08-01T10:00:00Z'), // 26h before NOW
    employeeId: 'e1',
    ...overrides,
  };
}

function makeScheduler(rules: SlaRule[], records: WatchedRecord[], lastFiring: Date | null = null) {
  const deps = {
    rules: { listAllActive: vi.fn().mockResolvedValue(rules) },
    holidays: { listBetween: vi.fn().mockResolvedValue([]) },
    firings: {
      // Batch memory: every candidate shares the same simulated last firing.
      lastFirings: vi
        .fn()
        .mockImplementation((_ruleId: string, ids: string[]) =>
          Promise.resolve(new Map(lastFiring ? ids.map((id) => [id, lastFiring] as const) : [])),
        ),
      record: vi.fn().mockResolvedValue({}),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
    notifications: {
      notifyExternal: vi.fn().mockResolvedValue(undefined),
      notifyTeam: vi.fn().mockResolvedValue(undefined),
    },
  };
  const expire = vi.fn().mockResolvedValue(undefined);
  const watcher: SlaWatcher = {
    processKey: 'EMPLOYEE',
    listInStatusSince: vi.fn().mockResolvedValue(records),
    subjectTemplate: (status) =>
      status === 'AWAITING_FORM' ? 'employee.form_reminder' : undefined,
    expire,
  };
  return { scheduler: new SlaScheduler(deps as never, [watcher]), deps, watcher, expire };
}

describe('SlaScheduler (generalized)', () => {
  it('REMIND notifies subject + role group, audits, and records the firing', async () => {
    const { scheduler, deps } = makeScheduler([rule({})], [record()]);
    await scheduler.tick(NOW);

    expect(deps.notifications.notifyExternal).toHaveBeenCalledWith(
      'sara@example.com',
      'employee.form_reminder',
      expect.objectContaining({ name: 'Sara Ahmed' }),
      { entity: 'EMPLOYEE', entityId: 'e1', companyId: 'co-a' },
      'ar',
    );
    expect(deps.notifications.notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ processKey: 'EMPLOYEE', status: 'AWAITING_FORM', role: 'HR' }),
      'staff.record_stalled',
      expect.objectContaining({ name: 'Sara Ahmed', status: 'AWAITING_FORM', daysWaiting: 1 }),
      expect.anything(),
    );
    expect(deps.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SLA_REMINDER', actorType: 'SYSTEM' }),
    );
    expect(deps.firings.record).toHaveBeenCalledWith('rule1', 'e1', NOW);
  });

  it('a one-shot REMIND never fires twice (sla_firings memory)', async () => {
    const { scheduler, deps } = makeScheduler(
      [rule({})],
      [record()],
      new Date('2026-08-01T13:00:00Z'),
    );
    await scheduler.tick(NOW);
    expect(deps.notifications.notifyTeam).not.toHaveBeenCalled();
    expect(deps.firings.record).not.toHaveBeenCalled();
  });

  it('REMIND_DAILY re-fires after ~a day but not sooner', async () => {
    const daily = rule({ action: 'REMIND_DAILY' });

    const old = makeScheduler([daily], [record()], new Date('2026-08-01T14:00:00Z')); // 22h ago
    await old.scheduler.tick(NOW);
    expect(old.deps.notifications.notifyTeam).toHaveBeenCalledTimes(1);

    const fresh = makeScheduler([daily], [record()], new Date('2026-08-02T09:00:00Z')); // 3h ago
    await fresh.scheduler.tick(NOW);
    expect(fresh.deps.notifications.notifyTeam).not.toHaveBeenCalled();
  });

  it('ESCALATE goes to the configured higher group, once, audited as escalation', async () => {
    const esc = rule({
      action: 'ESCALATE',
      afterValue: 5,
      afterUnit: 'CALENDAR_DAYS',
      escalateToRole: 'ADMIN',
    });
    const stale = record({ anchorAt: new Date('2026-07-26T10:00:00Z') }); // 7 days

    const first = makeScheduler([esc], [stale]);
    await first.scheduler.tick(NOW);
    expect(first.deps.notifications.notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN' }),
      'staff.escalation',
      expect.objectContaining({ daysWaiting: 7 }),
      expect.anything(),
    );
    expect(first.deps.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SLA_ESCALATION' }),
    );

    const repeat = makeScheduler([esc], [stale], NOW); // already fired
    await repeat.scheduler.tick(NOW);
    expect(repeat.deps.notifications.notifyTeam).not.toHaveBeenCalled();
  });

  it('EXPIRE delegates to the watcher and notifies the role group', async () => {
    const exp = rule({
      action: 'EXPIRE',
      afterValue: 10,
      afterUnit: 'CALENDAR_DAYS',
      notifySubject: false,
    });
    const stale = record({ anchorAt: new Date('2026-07-20T10:00:00Z') });

    const { scheduler, deps, expire } = makeScheduler([exp], [stale]);
    await scheduler.tick(NOW);

    expect(expire).toHaveBeenCalledWith(stale, 'rule1');
    expect(deps.notifications.notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'HR' }),
      'staff.record_expired',
      expect.anything(),
      expect.anything(),
    );
  });

  it('WORKING_DAYS rules respect the Fri/Sat weekend', async () => {
    const wd = rule({ afterValue: 2, afterUnit: 'WORKING_DAYS', notifySubject: false });

    // Thursday 10:00 → only Sunday counts by NOW → must NOT fire.
    const early = makeScheduler([wd], [record({ anchorAt: new Date('2026-07-30T10:00:00Z') })]);
    await early.scheduler.tick(NOW);
    expect(early.deps.notifications.notifyTeam).not.toHaveBeenCalled();

    // Tuesday → Wed + Thu + Sun = 3 working days → fires.
    const due = makeScheduler([wd], [record({ anchorAt: new Date('2026-07-28T10:00:00Z') })]);
    await due.scheduler.tick(NOW);
    expect(due.deps.notifications.notifyTeam).toHaveBeenCalledTimes(1);
  });

  it('rules for machines without a registered watcher are skipped safely', async () => {
    const { scheduler, deps } = makeScheduler([rule({ processKey: 'UNKNOWN' })], [record()]);
    await expect(scheduler.tick(NOW)).resolves.toBeUndefined();
    expect(deps.notifications.notifyTeam).not.toHaveBeenCalled();
  });

  it('deadline watchers (listDue) use their own template and meta params', async () => {
    const expiryRule = rule({
      processKey: 'DOCUMENT_EXPIRY',
      status: 'ANY',
      afterValue: 30,
      afterUnit: 'CALENDAR_DAYS',
      notifySubject: false,
    });
    const dueDoc: WatchedRecord = {
      id: 'doc1',
      name: 'Nora Khalid (EMP-0001)',
      anchorAt: new Date('2026-08-20T00:00:00Z'), // the expiry date itself
      employeeId: 'e1',
      meta: { docType: 'IQAMA', daysLeft: 18, expiryDate: '2026-08-20' },
    };
    const deps = {
      rules: { listAllActive: vi.fn().mockResolvedValue([expiryRule]) },
      holidays: { listBetween: vi.fn().mockResolvedValue([]) },
      firings: {
        lastFirings: vi.fn().mockResolvedValue(new Map()),
        record: vi.fn().mockResolvedValue({}),
      },
      audit: { append: vi.fn().mockResolvedValue({}) },
      notifications: {
        notifyExternal: vi.fn().mockResolvedValue(undefined),
        notifyTeam: vi.fn().mockResolvedValue(undefined),
      },
    };
    const watcher: SlaWatcher = {
      processKey: 'DOCUMENT_EXPIRY',
      listInStatusSince: vi.fn().mockResolvedValue([]),
      listDue: vi.fn().mockResolvedValue([dueDoc]),
      templates: { stalled: 'staff.document_expiring' },
    };

    await new SlaScheduler(deps as never, [watcher]).tick(NOW);

    // The watcher's dueness is trusted (no elapsed-time filtering) …
    expect(watcher.listDue).toHaveBeenCalledWith(
      expect.objectContaining({ afterValue: 30, status: 'ANY' }),
      NOW,
      expect.any(Number), // the per-tick batch cap
      { companyId: 'co-a', includeUnassigned: false }, // only this rule's company
    );
    // … the override template is used, and meta params flow through.
    expect(deps.notifications.notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ processKey: 'DOCUMENT_EXPIRY', role: 'HR' }),
      'staff.document_expiring',
      expect.objectContaining({ docType: 'IQAMA', daysLeft: 18, expiryDate: '2026-08-20' }),
      { entity: 'DOCUMENT_EXPIRY', entityId: 'doc1', companyId: 'co-a' },
    );
    expect(deps.firings.record).toHaveBeenCalledWith('rule1', 'doc1', NOW);
  });

  it('each rule watches its own company, with its own weekend and holidays', async () => {
    const ruleA = rule({ id: 'ra', companyId: 'co-main', afterValue: 2, afterUnit: 'WORKING_DAYS', notifySubject: false });
    const ruleB = rule({ id: 'rb', companyId: 'co-b', afterValue: 2, afterUnit: 'WORKING_DAYS', notifySubject: false });
    const calendar = {
      getCalendar: vi.fn(async (companyId: string) => ({ weekendDays: companyId === 'co-b' ? [0, 6] : [5, 6] })),
    };
    const deps = {
      rules: { listAllActive: vi.fn().mockResolvedValue([ruleA, ruleB]) },
      holidays: { listBetween: vi.fn().mockResolvedValue([]) },
      firings: { lastFirings: vi.fn().mockResolvedValue(new Map()), record: vi.fn().mockResolvedValue({}) },
      audit: { append: vi.fn().mockResolvedValue({}) },
      notifications: { notifyExternal: vi.fn(), notifyTeam: vi.fn().mockResolvedValue(undefined) },
      calendar,
      companies: { mainCompanyId: vi.fn().mockResolvedValue('co-main') },
    };
    // Anchored Thursday 2026-07-30: by Sunday NOW, Fri+Sat weekend → 1 working day (Sun);
    // a Sat+Sun weekend → 1 working day (Fri). Neither reaches 2, so use an older anchor.
    const old = record({ anchorAt: new Date('2026-07-26T10:00:00Z') });
    const watcher: SlaWatcher = { processKey: 'EMPLOYEE', listInStatusSince: vi.fn().mockResolvedValue([old]) };

    await new SlaScheduler(deps as never, [watcher]).tick(NOW);

    // The main company also watches records that were never placed in a company.
    expect(watcher.listInStatusSince).toHaveBeenCalledWith('AWAITING_FORM', expect.any(Date), expect.any(Number), {
      companyId: 'co-main',
      includeUnassigned: true,
    });
    expect(watcher.listInStatusSince).toHaveBeenCalledWith('AWAITING_FORM', expect.any(Date), expect.any(Number), {
      companyId: 'co-b',
      includeUnassigned: false,
    });
    expect(calendar.getCalendar).toHaveBeenCalledWith('co-main');
    expect(calendar.getCalendar).toHaveBeenCalledWith('co-b');
    expect(deps.holidays.listBetween).toHaveBeenCalledWith('co-b', expect.any(Date), NOW);
    // Messages carry the rule's company, so they use its wording and mail server.
    const refs = deps.notifications.notifyTeam.mock.calls.map((c) => c[3]);
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ companyId: 'co-main' }),
        expect.objectContaining({ companyId: 'co-b' }),
      ]),
    );
  });
});
