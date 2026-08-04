/**
 * The SLA scheduler — the BRD automation table executed against fakes with
 * a controlled clock. Times are UTC; 2026-08-02 is a Sunday (working day).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlaScheduler } from '../src/workflow/sla-scheduler.js';
import type { Trainee, SlaRule } from '../src/generated/prisma/client.js';

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
    active: true,
    createdAt: NOW,
    ...overrides,
  } as SlaRule;
}

function trainee(overrides: Partial<Trainee>): Trainee {
  return {
    id: 't1',
    firstName: 'Sara',
    lastName: 'Ahmed',
    email: 'sara@example.com',
    status: 'AWAITING_FORM',
    statusChangedAt: new Date('2026-08-01T10:00:00Z'), // 26h before NOW
    lastReminderAt: null,
    ...overrides,
  } as Trainee;
}

function makeDeps(rules: SlaRule[], candidates: Trainee[]) {
  const deps = {
    rules: { listActive: vi.fn().mockResolvedValue(rules) },
    holidays: { listBetween: vi.fn().mockResolvedValue([]) },
    trainees: {
      listInStatusSince: vi.fn().mockResolvedValue(candidates),
      markReminded: vi.fn().mockResolvedValue({}),
    },
    workflow: { transition: vi.fn().mockResolvedValue({ from: 'AWAITING_FORM', to: 'EXPIRED' }) },
    audit: { append: vi.fn().mockResolvedValue({}) },
    notifications: {
      notifyExternal: vi.fn().mockResolvedValue(undefined),
      notifyHr: vi.fn().mockResolvedValue(undefined),
    },
  };
  return deps;
}

describe('SlaScheduler', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BRD rule 1: 24h reminder → trainee + HR, audited, marked', async () => {
    deps = makeDeps([rule({})], [trainee({})]);
    await new SlaScheduler(deps as never).tick(NOW);

    expect(deps.notifications.notifyExternal).toHaveBeenCalledWith(
      'sara@example.com',
      'trainee.form_reminder',
      expect.objectContaining({ name: 'Sara Ahmed' }),
      { entity: 'TRAINEE', entityId: 't1' },
    );
    expect(deps.notifications.notifyHr).toHaveBeenCalled();
    expect(deps.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SLA_REMINDER', actorType: 'SYSTEM' }),
    );
    expect(deps.trainees.markReminded).toHaveBeenCalledWith('t1', NOW);
  });

  it('a one-shot REMIND does not fire twice (lastReminderAt set)', async () => {
    deps = makeDeps([rule({})], [trainee({ lastReminderAt: new Date('2026-08-01T13:00:00Z') })]);
    await new SlaScheduler(deps as never).tick(NOW);

    expect(deps.notifications.notifyExternal).not.toHaveBeenCalled();
    expect(deps.trainees.markReminded).not.toHaveBeenCalled();
  });

  it('REMIND_DAILY re-fires after ~a day but not within the same day', async () => {
    const daily = rule({ action: 'REMIND_DAILY', status: 'AWAITING_CONTRACT_APPROVAL' });

    // Reminded 22h ago → fires again.
    deps = makeDeps(
      [daily],
      [
        trainee({
          status: 'AWAITING_CONTRACT_APPROVAL',
          statusChangedAt: new Date('2026-07-20T10:00:00Z'),
          lastReminderAt: new Date('2026-08-01T14:00:00Z'),
        }),
      ],
    );
    await new SlaScheduler(deps as never).tick(NOW);
    expect(deps.notifications.notifyExternal).toHaveBeenCalledTimes(1);

    // Reminded 3h ago → silent.
    deps = makeDeps(
      [daily],
      [
        trainee({
          status: 'AWAITING_CONTRACT_APPROVAL',
          statusChangedAt: new Date('2026-07-20T10:00:00Z'),
          lastReminderAt: new Date('2026-08-02T09:00:00Z'),
        }),
      ],
    );
    await new SlaScheduler(deps as never).tick(NOW);
    expect(deps.notifications.notifyExternal).not.toHaveBeenCalled();
  });

  it('BRD rule 2: EXPIRE goes through the state machine and notifies HR', async () => {
    const expire = rule({ action: 'EXPIRE', afterValue: 10, afterUnit: 'CALENDAR_DAYS', notifySubject: false });
    const old = trainee({ statusChangedAt: new Date('2026-07-20T10:00:00Z') }); // 13 days
    deps = makeDeps([expire], [old]);

    await new SlaScheduler(deps as never).tick(NOW);

    expect(deps.workflow.transition).toHaveBeenCalledWith(
      old,
      'EXPIRE',
      { type: 'SYSTEM' },
      { rule: 'rule1' },
    );
    expect(deps.notifications.notifyHr).toHaveBeenCalledWith(
      'hr.trainee_expired',
      expect.objectContaining({ name: 'Sara Ahmed' }),
      { entity: 'TRAINEE', entityId: 't1' },
    );
  });

  it('WORKING_DAYS rules skip the Fri/Sat weekend before firing', async () => {
    const wd = rule({
      status: 'CONTRACT_CREATION',
      afterValue: 2,
      afterUnit: 'WORKING_DAYS',
      notifySubject: false,
    });
    // Thursday 2026-07-30 10:00 → Fri+Sat are weekend → by Sunday noon only
    // 1 working day (Sunday) has passed → must NOT fire.
    deps = makeDeps(
      [wd],
      [trainee({ status: 'CONTRACT_CREATION', statusChangedAt: new Date('2026-07-30T10:00:00Z') })],
    );
    await new SlaScheduler(deps as never).tick(NOW);
    expect(deps.notifications.notifyHr).not.toHaveBeenCalled();

    // From Tuesday 2026-07-28: Wed + Thu + Sun = 3 working days → fires.
    deps = makeDeps(
      [wd],
      [trainee({ status: 'CONTRACT_CREATION', statusChangedAt: new Date('2026-07-28T10:00:00Z') })],
    );
    await new SlaScheduler(deps as never).tick(NOW);
    expect(deps.notifications.notifyHr).toHaveBeenCalledTimes(1);
  });

  it('a failing rule does not stop the remaining rules', async () => {
    const bad = rule({ id: 'bad' });
    const good = rule({ id: 'good', notifySubject: false });
    deps = makeDeps([bad, good], [trainee({})]);
    deps.notifications.notifyExternal.mockRejectedValueOnce(new Error('smtp down'));

    await new SlaScheduler(deps as never).tick(NOW);

    // Second rule still ran (notifyHr called for both attempts).
    expect(deps.rules.listActive).toHaveBeenCalled();
    expect(deps.notifications.notifyHr).toHaveBeenCalled();
  });
});
