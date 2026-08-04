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
    processKey: 'TRAINEE',
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
    id: 't1',
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    anchorAt: new Date('2026-08-01T10:00:00Z'), // 26h before NOW
    traineeId: 't1',
    ...overrides,
  };
}

function makeScheduler(rules: SlaRule[], records: WatchedRecord[], lastFiring: Date | null = null) {
  const deps = {
    rules: { listAllActive: vi.fn().mockResolvedValue(rules) },
    holidays: { listBetween: vi.fn().mockResolvedValue([]) },
    firings: {
      lastFiring: vi.fn().mockResolvedValue(lastFiring),
      record: vi.fn().mockResolvedValue({}),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
    notifications: {
      notifyExternal: vi.fn().mockResolvedValue(undefined),
      notifyRole: vi.fn().mockResolvedValue(undefined),
    },
  };
  const expire = vi.fn().mockResolvedValue(undefined);
  const watcher: SlaWatcher = {
    processKey: 'TRAINEE',
    listInStatusSince: vi.fn().mockResolvedValue(records),
    subjectTemplate: (status) =>
      status === 'AWAITING_FORM' ? 'trainee.form_reminder' : undefined,
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
      'trainee.form_reminder',
      expect.objectContaining({ name: 'Sara Ahmed' }),
      { entity: 'TRAINEE', entityId: 't1' },
    );
    expect(deps.notifications.notifyRole).toHaveBeenCalledWith(
      'HR',
      'staff.record_stalled',
      expect.objectContaining({ name: 'Sara Ahmed', status: 'AWAITING_FORM', daysWaiting: 1 }),
      expect.anything(),
    );
    expect(deps.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SLA_REMINDER', actorType: 'SYSTEM' }),
    );
    expect(deps.firings.record).toHaveBeenCalledWith('rule1', 't1', NOW);
  });

  it('a one-shot REMIND never fires twice (sla_firings memory)', async () => {
    const { scheduler, deps } = makeScheduler(
      [rule({})],
      [record()],
      new Date('2026-08-01T13:00:00Z'),
    );
    await scheduler.tick(NOW);
    expect(deps.notifications.notifyRole).not.toHaveBeenCalled();
    expect(deps.firings.record).not.toHaveBeenCalled();
  });

  it('REMIND_DAILY re-fires after ~a day but not sooner', async () => {
    const daily = rule({ action: 'REMIND_DAILY' });

    const old = makeScheduler([daily], [record()], new Date('2026-08-01T14:00:00Z')); // 22h ago
    await old.scheduler.tick(NOW);
    expect(old.deps.notifications.notifyRole).toHaveBeenCalledTimes(1);

    const fresh = makeScheduler([daily], [record()], new Date('2026-08-02T09:00:00Z')); // 3h ago
    await fresh.scheduler.tick(NOW);
    expect(fresh.deps.notifications.notifyRole).not.toHaveBeenCalled();
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
    expect(first.deps.notifications.notifyRole).toHaveBeenCalledWith(
      'ADMIN',
      'staff.escalation',
      expect.objectContaining({ daysWaiting: 7 }),
      expect.anything(),
    );
    expect(first.deps.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SLA_ESCALATION' }),
    );

    const repeat = makeScheduler([esc], [stale], NOW); // already fired
    await repeat.scheduler.tick(NOW);
    expect(repeat.deps.notifications.notifyRole).not.toHaveBeenCalled();
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
    expect(deps.notifications.notifyRole).toHaveBeenCalledWith(
      'HR',
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
    expect(early.deps.notifications.notifyRole).not.toHaveBeenCalled();

    // Tuesday → Wed + Thu + Sun = 3 working days → fires.
    const due = makeScheduler([wd], [record({ anchorAt: new Date('2026-07-28T10:00:00Z') })]);
    await due.scheduler.tick(NOW);
    expect(due.deps.notifications.notifyRole).toHaveBeenCalledTimes(1);
  });

  it('rules for machines without a registered watcher are skipped safely', async () => {
    const { scheduler, deps } = makeScheduler([rule({ processKey: 'UNKNOWN' })], [record()]);
    await expect(scheduler.tick(NOW)).resolves.toBeUndefined();
    expect(deps.notifications.notifyRole).not.toHaveBeenCalled();
  });
});
